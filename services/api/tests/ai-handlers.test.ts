import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
  Context,
} from 'aws-lambda';
import type { AIJob } from '@campusmeet/shared';
import { describe, expect, it, vi } from 'vitest';
import { createAIHandlers } from '../src/ai/handlers';
import type { AIRequestService } from '../src/ai/request-service';
import { ForbiddenError } from '../src/utils/errors';
import { apiEvent } from './fixtures';

type AuthorizedRequestContext = APIGatewayProxyEventV2['requestContext'] & {
  authorizer?: { jwt?: { claims?: Record<string, unknown>; scopes?: string[] } };
};

const queuedJob: AIJob = {
  aiJobId: 'aij-1',
  groupId: 'group-1',
  meetingId: 'meeting-1',
  type: 'GENERATE_ANSWER',
  status: 'QUEUED',
  attempt: 0,
  requestId: 'test-request-id',
  provider: 'BEDROCK',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

const authenticatedEvent = (
  path: string,
  body: unknown,
  pathParameters: Record<string, string>,
): APIGatewayProxyEventV2 => {
  const event = apiEvent(path);
  event.requestContext.http.method = 'POST';
  event.headers = { 'idempotency-key': 'idem-1' };
  event.body = JSON.stringify(body);
  event.pathParameters = pathParameters;
  (event.requestContext as AuthorizedRequestContext).authorizer = {
    jwt: { claims: { sub: 'user-1' }, scopes: [] },
  };
  return event;
};

const setup = () => {
  const service = {
    requestMeetingChat: vi.fn().mockResolvedValue(queuedJob),
    requestGroupSearch: vi.fn().mockResolvedValue(queuedJob),
    requestMinutesDraft: vi.fn().mockResolvedValue(queuedJob),
    requestTaskProposals: vi.fn().mockResolvedValue(queuedJob),
    requestProgressAnalysis: vi.fn().mockResolvedValue(queuedJob),
  } as unknown as AIRequestService;
  const getService = vi.fn(() => service);
  return { service, getService, handlers: createAIHandlers(getService) };
};

const invoke = async (
  handler: ReturnType<typeof createAIHandlers>[keyof ReturnType<typeof createAIHandlers>],
  event: APIGatewayProxyEventV2,
) => (await handler(event, {} as Context, vi.fn())) as APIGatewayProxyStructuredResultV2;

const bodyOf = (response: APIGatewayProxyStructuredResultV2) =>
  JSON.parse(response.body ?? '{}') as Record<string, unknown>;

describe('M5 AI thin handlers', () => {
  it('returns 202 and forwards authenticated meeting chat input', async () => {
    const { handlers, service } = setup();
    const event = authenticatedEvent(
      '/meetings/meeting-1/ai/chat',
      { question: 'Cuộc họp đã quyết định gì?', intent: 'QUESTION_ANSWER' },
      { meetingId: 'meeting-1' },
    );

    const response = await invoke(handlers.meetingChatHandler, event);

    expect(response.statusCode).toBe(202);
    expect(bodyOf(response)).toMatchObject({
      success: true,
      data: { aiJobId: 'aij-1', status: 'QUEUED' },
      requestId: 'test-request-id',
    });
    expect(service.requestMeetingChat).toHaveBeenCalledWith({
      actorId: 'user-1',
      meetingId: 'meeting-1',
      request: { question: 'Cuộc họp đã quyết định gì?', intent: 'QUESTION_ANSWER' },
      idempotencyKey: 'idem-1',
      requestId: 'test-request-id',
    });
  });

  it('maps selected-meeting search without accepting a client group override', async () => {
    const { handlers, service } = setup();
    const event = authenticatedEvent(
      '/groups/group-1/ai/search',
      {
        question: 'Tìm quyết định',
        scope: 'SELECTED_MEETINGS',
        meetingIds: ['meeting-1', 'meeting-2'],
        groupId: 'group-from-body',
      },
      { groupId: 'group-1' },
    );

    const response = await invoke(handlers.groupSearchHandler, event);

    expect(response.statusCode).toBe(202);
    expect(service.requestGroupSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'user-1',
        groupId: 'group-1',
        request: {
          question: 'Tìm quyết định',
          scope: 'SELECTED_MEETINGS',
          meetingIds: ['meeting-1', 'meeting-2'],
        },
      }),
    );
  });

  it('rejects a request without a JWT subject before calling the service', async () => {
    const { getService, handlers, service } = setup();
    const event = authenticatedEvent(
      '/meetings/meeting-1/ai/chat',
      { question: 'Tóm tắt' },
      { meetingId: 'meeting-1' },
    );
    delete (event.requestContext as AuthorizedRequestContext).authorizer;

    const response = await invoke(handlers.meetingChatHandler, event);

    expect(response.statusCode).toBe(401);
    expect(bodyOf(response)).toMatchObject({
      success: false,
      error: { code: 'UNAUTHORIZED' },
    });
    expect(getService).not.toHaveBeenCalled();
    expect(service.requestMeetingChat).not.toHaveBeenCalled();
  });

  it('requires Idempotency-Key for every asynchronous request', async () => {
    const { getService, handlers, service } = setup();
    const event = authenticatedEvent(
      '/meetings/meeting-1/ai/minutes-draft',
      {},
      { meetingId: 'meeting-1' },
    );
    event.headers = {};

    const response = await invoke(handlers.minutesDraftHandler, event);

    expect(response.statusCode).toBe(400);
    expect(bodyOf(response)).toMatchObject({ success: false, error: { code: 'BAD_REQUEST' } });
    expect(getService).not.toHaveBeenCalled();
    expect(service.requestMinutesDraft).not.toHaveBeenCalled();
  });

  it('rejects an invalid selected-meeting request at the HTTP boundary', async () => {
    const { getService, handlers, service } = setup();
    const event = authenticatedEvent(
      '/groups/group-1/ai/search',
      { question: 'Tìm quyết định', scope: 'SELECTED_MEETINGS' },
      { groupId: 'group-1' },
    );

    const response = await invoke(handlers.groupSearchHandler, event);

    expect(response.statusCode).toBe(400);
    expect(getService).not.toHaveBeenCalled();
    expect(service.requestGroupSearch).not.toHaveBeenCalled();
  });

  it('preserves authorization errors from the application service', async () => {
    const { handlers, service } = setup();
    vi.mocked(service.requestProgressAnalysis).mockRejectedValue(new ForbiddenError());
    const event = authenticatedEvent(
      '/groups/group-1/ai/progress-analysis',
      {},
      { groupId: 'group-1' },
    );

    const response = await invoke(handlers.progressAnalysisHandler, event);

    expect(response.statusCode).toBe(403);
    expect(bodyOf(response)).toMatchObject({ success: false, error: { code: 'FORBIDDEN' } });
  });
});
