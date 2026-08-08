import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { apiEvent } from './fixtures';

const mocks = vi.hoisted(() => ({
  getCanonical: vi.fn(),
  getById: vi.fn(),
  updateSegment: vi.fn(),
  getAllSegments: vi.fn(),
  getApprovalHandoff: vi.fn(),
  getApprovalIntent: vi.fn(),
  bindApprovalIntent: vi.fn(),
  approve: vi.fn(),
  getMeeting: vi.fn(),
  getMembership: vi.fn(),
  writeImmutable: vi.fn(),
  prepareJob: vi.fn(),
  ensureStarted: vi.fn(),
}));
vi.mock('../src/repositories/transcripts', () => ({
  DynamoDbTranscriptRepository: class {
    getCanonical = mocks.getCanonical;
    getById = mocks.getById;
    updateSegment = mocks.updateSegment;
    getAllSegments = mocks.getAllSegments;
    getApprovalHandoff = mocks.getApprovalHandoff;
    getApprovalIntent = mocks.getApprovalIntent;
    bindApprovalIntent = mocks.bindApprovalIntent;
    approve = mocks.approve;
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
vi.mock('../src/integrations/s3', () => ({
  immutableObjectStore: { writeImmutable: mocks.writeImmutable },
}));
vi.mock('../src/ai/aws-adapters', () => ({
  createProductionAIJobOrchestrator: () => ({
    prepareJob: mocks.prepareJob,
    enqueue: vi.fn(),
    ensureStarted: mocks.ensureStarted,
  }),
}));
import {
  meetingTranscriptsHandler,
  transcriptApprovalHandler,
  transcriptSegmentHandler,
} from '../src/handlers/transcripts';
const payload = (response: unknown) =>
  JSON.parse(String((response as APIGatewayProxyStructuredResultV2).body));

const authenticated = (path: string, method: 'GET' | 'PATCH' | 'POST') => {
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
  mocks.getApprovalIntent.mockResolvedValue(null);
  mocks.getAllSegments.mockResolvedValue([
    {
      segmentId: 'seg',
      transcriptId: 'tx',
      sequence: 1,
      startMs: 0,
      endMs: 100,
      text: 'Text',
      confidence: 1,
      languageCode: 'vi-VN',
      speakerLabel: 'Speaker 1',
      isFinal: true,
      version: 1,
    },
  ]);
  mocks.writeImmutable.mockResolvedValue({ sha256: 'checksum' });
  mocks.prepareJob.mockReturnValue({
    aiJobId: 'aij-1',
    persistenceContribution: { Put: {} },
  });
  const approvedTranscript = {
    transcriptId: 'tx',
    meetingId: 'meeting-1',
    groupId: 'group-1',
    status: 'APPROVED',
    version: 1,
    approvedVersion: 1,
    approvedBy: 'admin-1',
    approvedAt: '2026-08-08T01:00:00.000Z',
    createdAt: '2026-08-08T00:00:00.000Z',
    updatedAt: '2026-08-08T01:00:00.000Z',
  };
  mocks.approve.mockResolvedValue({
    transcript: approvedTranscript,
    handoff: { aiJobId: 'aij-1' },
  });
  mocks.ensureStarted.mockResolvedValue({
    aiJobId: 'aij-1',
    groupId: 'group-1',
    meetingId: 'meeting-1',
    type: 'INGEST_SOURCE',
    status: 'QUEUED',
    attempt: 0,
    requestId: 'request-1',
    createdAt: '2026-08-08T01:00:00.000Z',
    updatedAt: '2026-08-08T01:00:00.000Z',
  });
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
describe('POST Transcript approval handler', () => {
  const call = async (body: unknown, key?: string) => {
    const event = authenticated('/transcripts/tx/approve', 'POST');
    event.pathParameters = { transcriptId: 'tx' };
    event.body = JSON.stringify(body);
    if (key) event.headers['idempotency-key'] = key;
    return transcriptApprovalHandler(event, {} as never, () => undefined);
  };
  it('parses the shared contract and required idempotency key', async () => {
    const response = await call({ expectedVersion: 1 }, 'idem-1');
    expect(response).toMatchObject({ statusCode: 200 });
    expect(mocks.approve).toHaveBeenCalled();
    expect(payload(response)).toMatchObject({
      success: true,
      data: { transcript: { status: 'APPROVED', version: 1 }, aiJob: { aiJobId: 'aij-1' } },
    });
  });
  it.each([
    [{ expectedVersion: 1 }, undefined],
    [{ expectedVersion: 0 }, 'idem'],
    [{ expectedVersion: 1, approvedBy: 'attacker' }, 'idem'],
  ])('returns 400 for missing key or malformed body', async (body, key) => {
    const response = await call(body, key);
    expect(response).toMatchObject({ statusCode: 400 });
  });
});
