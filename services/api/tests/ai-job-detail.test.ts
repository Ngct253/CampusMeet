import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
  Context,
} from 'aws-lambda';
import type { AIJob } from '@campusmeet/shared';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { aiJobDetailHandler } from '../src/handlers/ai-jobs';
import { apiEvent } from './fixtures';

type AuthorizedRequestContext = APIGatewayProxyEventV2['requestContext'] & {
  authorizer?: { jwt?: { claims?: Record<string, unknown> } };
};

const queuedJob: AIJob = {
  aiJobId: 'aij-test-1',
  groupId: 'group-1',
  meetingId: 'meeting-1',
  type: 'GENERATE_ANSWER',
  status: 'QUEUED',
  attempt: 0,
  requestId: 'req-1',
  provider: 'BEDROCK',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

const authenticatedGetEvent = (aiJobId: string): APIGatewayProxyEventV2 => {
  const event = apiEvent(`/ai/jobs/${aiJobId}`);
  event.pathParameters = { aiJobId };
  (event.requestContext as AuthorizedRequestContext).authorizer = {
    jwt: { claims: { sub: 'user-1' } },
  };
  return event;
};

const invoke = async (event: APIGatewayProxyEventV2) =>
  (await aiJobDetailHandler(event, {} as Context, vi.fn())) as APIGatewayProxyStructuredResultV2;

const bodyOf = (response: APIGatewayProxyStructuredResultV2) =>
  JSON.parse(response.body ?? '{}') as Record<string, unknown>;

vi.mock('../src/repositories/client', () => ({
  documentClient: { send: vi.fn() },
}));

vi.mock('../src/middleware/authorization', () => ({
  requireGroupMembership: vi.fn().mockResolvedValue({ userId: 'user-1', groupId: 'group-1' }),
}));

describe('GET /ai/jobs/:aiJobId', () => {
  beforeEach(async () => {
    process.env.AI_WORK_TABLE = 'test-ai-work-table';
    const { documentClient } = await import('../src/repositories/client');
    vi.mocked(documentClient.send).mockResolvedValue({
      Item: {
        PK: `AIJOB#${queuedJob.aiJobId}`,
        SK: 'META',
        ...queuedJob,
      },
    } as never);
  });

  it('returns 200 with AIJob shape for a group member', async () => {
    const event = authenticatedGetEvent(queuedJob.aiJobId);
    const response = await invoke(event);

    expect(response.statusCode).toBe(200);
    expect(bodyOf(response)).toMatchObject({
      success: true,
      data: { aiJobId: queuedJob.aiJobId, status: 'QUEUED', groupId: 'group-1' },
    });
  });

  it('returns 404 when the job does not exist', async () => {
    const { documentClient } = await import('../src/repositories/client');
    vi.mocked(documentClient.send).mockResolvedValue({ Item: undefined } as never);

    const event = authenticatedGetEvent('nonexistent-job');
    const response = await invoke(event);

    expect(response.statusCode).toBe(404);
    expect(bodyOf(response)).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
  });

  it('returns 403 when the user is not a member of the job group', async () => {
    const { requireGroupMembership } = await import('../src/middleware/authorization');
    const { ForbiddenError } = await import('../src/utils/errors');
    vi.mocked(requireGroupMembership).mockRejectedValue(
      new ForbiddenError('Bạn không phải thành viên của nhóm này.'),
    );

    const event = authenticatedGetEvent(queuedJob.aiJobId);
    const response = await invoke(event);

    expect(response.statusCode).toBe(403);
    expect(bodyOf(response)).toMatchObject({ success: false, error: { code: 'FORBIDDEN' } });
  });

  it('returns 401 when no JWT is present', async () => {
    const event = authenticatedGetEvent(queuedJob.aiJobId);
    delete (event.requestContext as AuthorizedRequestContext).authorizer;

    const response = await invoke(event);

    expect(response.statusCode).toBe(401);
    expect(bodyOf(response)).toMatchObject({ success: false, error: { code: 'UNAUTHORIZED' } });
  });
});
