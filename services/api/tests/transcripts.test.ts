import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { apiEvent } from './fixtures';

const mocks = vi.hoisted(() => ({
  getCanonical: vi.fn(),
  getById: vi.fn(),
  updateSegment: vi.fn(),
  getMeeting: vi.fn(),
  getMembership: vi.fn(),
}));
vi.mock('../src/repositories/transcripts', () => ({
  DynamoDbTranscriptRepository: class {
    getCanonical = mocks.getCanonical;
    getById = mocks.getById;
    updateSegment = mocks.updateSegment;
  },
}));
vi.mock('../src/repositories/dynamodb', () => ({
  DynamoDbMeetingRepository: class {
    getById = mocks.getMeeting;
  },
}));
vi.mock('../src/repositories/collaboration', () => ({
  DynamoDbCollaborationRepository: class {
    getMembership = mocks.getMembership;
  },
}));
import { meetingTranscriptsHandler, transcriptSegmentHandler } from '../src/handlers/transcripts';
const payload = (response: unknown) =>
  JSON.parse(String((response as APIGatewayProxyStructuredResultV2).body));

const authenticated = (path: string, method: 'GET' | 'PATCH') => {
  const event = apiEvent(path);
  event.requestContext.http.method = method;
  (
    event.requestContext as typeof event.requestContext & {
      authorizer: { jwt: { claims: Record<string, unknown>; scopes: string[] } };
    }
  ).authorizer = { jwt: { claims: { sub: 'admin-1' }, scopes: [] } };
  return event;
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.getMeeting.mockResolvedValue({
    id: 'meeting-1',
    groupId: 'group-1',
    organizerId: 'admin-1',
  });
  mocks.getMembership.mockResolvedValue({
    userId: 'admin-1',
    groupId: 'group-1',
    role: 'GROUP_ADMIN',
    active: true,
  });
  mocks.getCanonical.mockResolvedValue({ transcript: null, segments: [] });
  mocks.getById.mockResolvedValue({
    transcriptId: 'tx',
    meetingId: 'meeting-1',
    groupId: 'group-1',
    status: 'READY',
    version: 1,
    createdAt: '2026-08-08T00:00:00.000Z',
    updatedAt: '2026-08-08T00:00:00.000Z',
  });
  mocks.updateSegment.mockResolvedValue({ transcript: {}, segment: {} });
});
describe('GET Transcript handler', () => {
  it('authenticates and forwards default limit 50', async () => {
    const event = authenticated('/meetings/meeting-1/transcripts', 'GET');
    event.pathParameters = { meetingId: 'meeting-1' };
    const response = await meetingTranscriptsHandler(event, {} as never, () => undefined);
    expect(response).toMatchObject({ statusCode: 200 });
    expect(mocks.getCanonical).toHaveBeenCalledWith('meeting-1', 'group-1', 50, undefined);
    expect(payload(response)).toMatchObject({
      success: true,
      data: { transcript: null, segments: [] },
    });
  });
  it('forwards a valid limit and cursor', async () => {
    const event = authenticated('/meetings/meeting-1/transcripts', 'GET');
    event.pathParameters = { meetingId: 'meeting-1' };
    event.queryStringParameters = { limit: '25', cursor: 'opaque' };
    await meetingTranscriptsHandler(event, {} as never, () => undefined);
    expect(mocks.getCanonical).toHaveBeenCalledWith('meeting-1', 'group-1', 25, 'opaque');
  });
  it.each(['0', '101', '1.5', 'nope'])(
    'returns standard 400 for invalid limit %s',
    async (limit) => {
      const event = authenticated('/meetings/meeting-1/transcripts', 'GET');
      event.pathParameters = { meetingId: 'meeting-1' };
      event.queryStringParameters = { limit };
      const response = await meetingTranscriptsHandler(event, {} as never, () => undefined);
      expect(response).toMatchObject({ statusCode: 400 });
      expect(payload(response)).toMatchObject({
        success: false,
        error: { code: 'BAD_REQUEST' },
      });
    },
  );
  it('requires authentication', async () => {
    const event = apiEvent('/meetings/meeting-1/transcripts');
    event.pathParameters = { meetingId: 'meeting-1' };
    const response = await meetingTranscriptsHandler(event, {} as never, () => undefined);
    expect(response).toMatchObject({ statusCode: 401 });
  });
});
describe('PATCH Transcript segment handler', () => {
  const call = async (body: unknown) => {
    const event = authenticated('/transcripts/tx/segments/seg', 'PATCH');
    event.pathParameters = { transcriptId: 'tx', segmentId: 'seg' };
    event.body = JSON.stringify(body);
    return transcriptSegmentHandler(event, {} as never, () => undefined);
  };
  it('accepts the strict edit and returns standard success', async () => {
    const response = await call({ expectedVersion: 1, text: 'Changed' });
    expect(response).toMatchObject({ statusCode: 200 });
    expect(mocks.updateSegment).toHaveBeenCalled();
    expect(payload(response)).toMatchObject({ success: true });
  });
  it.each([
    { text: 'Changed' },
    { expectedVersion: 1 },
    { expectedVersion: 1, text: 'Changed', updatedBy: 'attacker' },
  ])('returns standard 400 for invalid strict body', async (body) => {
    const response = await call(body);
    expect(response).toMatchObject({ statusCode: 400 });
    expect(payload(response)).toMatchObject({
      success: false,
      error: { code: 'BAD_REQUEST' },
    });
    expect(mocks.updateSegment).not.toHaveBeenCalled();
  });
  it('requires authentication', async () => {
    const event = apiEvent('/transcripts/tx/segments/seg');
    event.requestContext.http.method = 'PATCH';
    event.pathParameters = { transcriptId: 'tx', segmentId: 'seg' };
    event.body = JSON.stringify({ expectedVersion: 1, text: 'Changed' });
    const response = await transcriptSegmentHandler(event, {} as never, () => undefined);
    expect(response).toMatchObject({ statusCode: 401 });
  });
});
