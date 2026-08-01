import { describe, expect, it, vi } from 'vitest';
import type { AIJob } from '@campusmeet/shared';
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
    const fetcher = vi.fn(async () =>
      jsonResponse({
        success: true,
        data: { ...job, status: 'COMPLETED' },
        requestId: 'request-1',
      }),
    );
    const service = createAIService({
      baseUrl: 'https://api.example.test',
      fetcher: fetcher as typeof fetch,
      getAccessToken: async () => 'access-token',
    });

    await service.getJob('job/one');

    expect(fetcher).toHaveBeenCalledWith(
      'https://api.example.test/ai/jobs/job%2Fone',
      expect.objectContaining({ headers: { authorization: 'Bearer access-token' } }),
    );
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
