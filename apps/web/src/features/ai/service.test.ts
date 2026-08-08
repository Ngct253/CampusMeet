import { describe, expect, it, vi } from 'vitest';
import { Priority, TaskStatus, type AIJob, type TaskProposal } from '@campusmeet/shared';
import { AIServiceError, createAIService } from './service';

const job: AIJob = {
  aiJobId: 'job-1',
  groupId: 'group-1',
  meetingId: 'meeting-1',
  type: 'GENERATE_ANSWER',
  status: 'QUEUED',
  attempt: 0,
  requestId: 'request-1',
  provider: 'BEDROCK',
  createdAt: '2026-08-01T01:00:00.000Z',
  updatedAt: '2026-08-01T01:00:00.000Z',
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

describe('AI service', () => {
  it('sends an authenticated, idempotent meeting chat request', async () => {
    const fetcher = vi.fn<typeof fetch>();
    fetcher.mockResolvedValue(
      jsonResponse({ success: true, data: job, requestId: 'request-1' }, 202),
    );
    const service = createAIService({
      baseUrl: 'https://api.example.test',
      fetcher,
      getAccessToken: async () => 'access-token',
    });

    await expect(
      service.meetingChat(
        'meeting/one',
        { question: 'Quyết định nào đã được chốt?', intent: 'QUESTION_ANSWER' },
        'idempotency-1',
      ),
    ).resolves.toEqual(job);

    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe('https://api.example.test/meetings/meeting%2Fone/ai/chat');
    expect(init).toMatchObject({
      method: 'POST',
      headers: {
        authorization: 'Bearer access-token',
        'content-type': 'application/json',
        'idempotency-key': 'idempotency-1',
      },
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      question: 'Quyết định nào đã được chốt?',
      intent: 'QUESTION_ANSWER',
    });
  });

  it('polls a job without adding a mutation header', async () => {
    const result = {
      answer: 'Không có đủ nguồn để trả lời.',
      citations: [],
      scope: 'CURRENT_MEETING' as const,
      insufficientContext: true,
    };
    const fetcher = vi.fn(async () =>
      jsonResponse({
        success: true,
        data: { ...job, status: 'COMPLETED', result },
        requestId: 'request-1',
      }),
    );
    const service = createAIService({
      baseUrl: 'https://api.example.test',
      fetcher: fetcher as typeof fetch,
      getAccessToken: async () => 'access-token',
    });

    await expect(service.getJob('job/one')).resolves.toMatchObject({ result });

    expect(fetcher).toHaveBeenCalledWith(
      'https://api.example.test/ai/jobs/job%2Fone',
      expect.objectContaining({ headers: { authorization: 'Bearer access-token' } }),
    );
  });

  it('confirms a task proposal through the protected idempotent endpoint', async () => {
    const proposal: TaskProposal = {
      proposalId: 'proposal/one',
      groupId: 'group-1',
      meetingId: 'meeting-1',
      title: 'Hoàn thiện bản demo',
      assigneeId: 'user-1',
      priority: Priority.HIGH,
      missingFields: [],
      citations: [
        {
          citationId: 'citation-1',
          groupId: 'group-1',
          meetingId: 'meeting-1',
          sourceType: 'TRANSCRIPT',
          sourceId: 'transcript-1',
          sourceVersion: 1,
          internalUri: 'campusmeet://meetings/meeting-1/transcripts/transcript-1',
        },
      ],
      status: 'EXECUTED',
      taskId: 'task-1',
    };
    const task = {
      id: 'task-1',
      groupId: 'group-1',
      title: proposal.title,
      assigneeId: 'user-1',
      priority: Priority.HIGH,
      status: TaskStatus.TODO,
      sourceMeetingId: 'meeting-1',
    };
    const fetcher = vi.fn<typeof fetch>();
    fetcher.mockResolvedValue(
      jsonResponse({ success: true, data: { proposal, task }, requestId: 'request-1' }),
    );
    const service = createAIService({
      baseUrl: 'https://api.example.test',
      fetcher,
      getAccessToken: async () => 'access-token',
    });

    await expect(
      service.confirmTaskProposal(
        'proposal/one',
        { assigneeId: 'user-1', priority: Priority.HIGH },
        'confirm-key',
      ),
    ).resolves.toEqual({ proposal, task });

    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe('https://api.example.test/ai/task-proposals/proposal%2Fone/confirm');
    expect(init).toMatchObject({
      method: 'POST',
      headers: {
        authorization: 'Bearer access-token',
        'content-type': 'application/json',
        'idempotency-key': 'confirm-key',
      },
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      assigneeId: 'user-1',
      priority: Priority.HIGH,
    });
  });

  it('preserves the API error code and safe message', async () => {
    const service = createAIService({
      baseUrl: 'https://api.example.test',
      fetcher: vi.fn(async () =>
        jsonResponse(
          {
            success: false,
            error: { code: 'FORBIDDEN', message: 'Bạn không có quyền truy cập.' },
          },
          403,
        ),
      ) as typeof fetch,
      getAccessToken: async () => undefined,
    });

    const result = service.getJob('job-1');
    await expect(result).rejects.toBeInstanceOf(AIServiceError);
    await expect(result).rejects.toMatchObject({
      status: 403,
      code: 'FORBIDDEN',
      message: 'Bạn không có quyền truy cập.',
    });
  });

  it('rejects a malformed AIJob at the frontend trust boundary', async () => {
    const service = createAIService({
      baseUrl: 'https://api.example.test',
      fetcher: vi.fn(async () =>
        jsonResponse({
          success: true,
          data: { ...job, status: 'UNKNOWN' },
          requestId: 'request-1',
        }),
      ) as typeof fetch,
      getAccessToken: async () => undefined,
    });

    await expect(service.getJob('job-1')).rejects.toThrow();
  });

  it('fails safely when the API URL is not configured', async () => {
    const fetcher = vi.fn();
    const service = createAIService({
      baseUrl: '',
      fetcher: fetcher as typeof fetch,
      getAccessToken: async () => 'access-token',
    });

    await expect(service.getJob('job-1')).rejects.toMatchObject({
      status: 503,
      code: 'API_NOT_CONFIGURED',
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
