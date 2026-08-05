import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import {
  GoogleSyncStatus,
  IntegrationStatus,
  MeetingStatus,
  type Meeting,
} from '@campusmeet/shared';
import { apiEvent } from './fixtures';

const send = vi.hoisted(() => vi.fn());
const getMeetingById = vi.hoisted(() => vi.fn());
vi.mock('../src/repositories/client', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/repositories/client')>();
  return { ...original, documentClient: { send } };
});
vi.mock('../src/repositories/dynamodb', () => ({
  DynamoDbMeetingRepository: class {
    getById = getMeetingById;
  },
}));

import { minutesHandler } from '../src/handlers/minutes';
import { DynamoDbMinutesRepository } from '../src/repositories/minutes';

const meeting: Meeting = {
  id: 'meeting-1',
  groupId: 'group-1',
  title: 'Họp tuần',
  organizerId: 'admin-1',
  attendeeIds: ['admin-1'],
  agenda: [],
  startsAt: '2026-08-04T01:00:00.000Z',
  endsAt: '2026-08-04T02:00:00.000Z',
  status: MeetingStatus.COMPLETED,
  googleSyncStatus: GoogleSyncStatus.NOT_REQUESTED,
  integrationStatus: IntegrationStatus.READY,
  createdAt: '2026-08-01T00:00:00.000Z',
  createdBy: 'admin-1',
  updatedAt: '2026-08-01T00:00:00.000Z',
  updatedBy: 'admin-1',
  version: 1,
};
const minutesItem = {
  PK: 'MEETING#meeting-1',
  SK: 'MINUTES#VERSION#000001',
  entityType: 'MEETING_MINUTES',
  id: 'minutes-1',
  meetingId: 'meeting-1',
  groupId: 'group-1',
  summary: 'Tóm tắt',
  discussion: '',
  decisions: [{ id: 'decision-1', content: 'Quyết định' }],
  actionItems: [{ id: 'action-1', content: 'Hành động', assigneeId: 'user-1' }],
  version: 1,
  createdBy: 'admin-1',
  createdAt: '2026-08-04T03:00:00.000Z',
};

const authenticatedEvent = (method: 'GET' | 'PUT' = 'GET') => {
  const event = apiEvent('/meetings/meeting-1/minutes');
  event.requestContext.http.method = method;
  event.pathParameters = { meetingId: 'meeting-1' };
  const requestContext = event.requestContext as typeof event.requestContext & {
    authorizer: { jwt: { claims: Record<string, unknown>; scopes: string[] } };
  };
  requestContext.authorizer = { jwt: { claims: { sub: 'admin-1' }, scopes: [] } };
  return event;
};

describe('DynamoDbMinutesRepository', () => {
  beforeEach(() => {
    send.mockReset();
    process.env.MEETING_DATA_TABLE = 'campusmeet-test-meeting-data';
  });

  it('queries the latest immutable version consistently without a GSI or Scan', async () => {
    send.mockResolvedValueOnce({ Items: [minutesItem] });
    await expect(new DynamoDbMinutesRepository().getLatest('meeting-1')).resolves.toMatchObject({
      id: 'minutes-1',
      version: 1,
    });
    const command = send.mock.calls[0]?.[0] as {
      constructor: { name: string };
      input: Record<string, unknown>;
    };
    expect(command.constructor.name).toBe('QueryCommand');
    expect(command.input).toMatchObject({
      TableName: 'campusmeet-test-meeting-data',
      KeyConditionExpression: 'PK = :meeting AND begins_with(SK, :minutes)',
      ExpressionAttributeValues: {
        ':meeting': 'MEETING#meeting-1',
        ':minutes': 'MINUTES#VERSION#',
      },
      ScanIndexForward: false,
      Limit: 1,
      ConsistentRead: true,
    });
    expect(command.input).not.toHaveProperty('IndexName');
    expect(command.constructor.name).not.toBe('ScanCommand');
  });

  it('returns null only when no item exists and rejects malformed persisted Minutes', async () => {
    send.mockResolvedValueOnce({ Items: [] });
    await expect(new DynamoDbMinutesRepository().getLatest('meeting-1')).resolves.toBeNull();
    send.mockResolvedValueOnce({ Items: [{ ...minutesItem, createdBy: undefined }] });
    await expect(new DynamoDbMinutesRepository().getLatest('meeting-1')).rejects.toThrow(
      'Malformed meeting minutes item.',
    );
  });

  it.each([
    ['entity type', { entityType: 'MEETING' }],
    ['partition key', { PK: 'MEETING#other-meeting' }],
    ['sort key format', { SK: 'MINUTES#VERSION#0001' }],
    ['meeting id', { meetingId: 'other-meeting' }],
    ['version encoded in the sort key', { SK: 'MINUTES#VERSION#000002' }],
    ['created timestamp', { createdAt: '2026-02-30T03:00:00.000Z' }],
  ])('rejects a persisted item with invalid %s', async (_label, override) => {
    send.mockResolvedValueOnce({ Items: [{ ...minutesItem, ...override }] });
    await expect(new DynamoDbMinutesRepository().getLatest('meeting-1')).rejects.toThrow(
      'Malformed meeting minutes item.',
    );
  });

  it('puts a six-digit version with server metadata and unique row ids', async () => {
    send.mockResolvedValueOnce({});
    const result = await new DynamoDbMinutesRepository().createVersion(
      meeting,
      'actor-from-jwt',
      {
        summary: 'Tóm tắt',
        discussion: '',
        decisions: [{ content: 'A' }, { content: 'B' }],
        actionItems: [{ content: 'C' }, { content: 'D', assigneeId: 'user-1' }],
        expectedVersion: 6,
      },
      7,
      'minutes-1',
    );
    const command = send.mock.calls[0]?.[0] as {
      constructor: { name: string };
      input: Record<string, unknown>;
    };
    const item = command.input.Item as Record<string, unknown>;
    expect(command.constructor.name).toBe('PutCommand');
    expect(command.input.ConditionExpression).toBe(
      'attribute_not_exists(PK) AND attribute_not_exists(SK)',
    );
    expect(item).toMatchObject({
      PK: 'MEETING#meeting-1',
      SK: 'MINUTES#VERSION#000007',
      entityType: 'MEETING_MINUTES',
      id: 'minutes-1',
      meetingId: 'meeting-1',
      groupId: 'group-1',
      version: 7,
      createdBy: 'actor-from-jwt',
    });
    expect(item).not.toHaveProperty('GSI1PK');
    expect(item).not.toHaveProperty('GSI2PK');
    const ids = [...result.decisions, ...result.actionItems].map(({ id }) => id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(result.actionItems[1]).not.toHaveProperty('taskId');
  });

  it('maps a conditional race to 409 only after a consistent latest query observes a new version', async () => {
    const conditional = Object.assign(new Error('conditional'), {
      name: 'ConditionalCheckFailedException',
    });
    send.mockRejectedValueOnce(conditional).mockResolvedValueOnce({
      Items: [{ ...minutesItem, version: 2, SK: 'MINUTES#VERSION#000002' }],
    });
    await expect(
      new DynamoDbMinutesRepository().createVersion(
        meeting,
        'admin-1',
        {
          summary: 'Tóm tắt',
          discussion: '',
          decisions: [],
          actionItems: [],
          expectedVersion: 1,
        },
        2,
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT', statusCode: 409 });
    const recovery = send.mock.calls[1]?.[0] as { input: Record<string, unknown> };
    expect(recovery.input.ConsistentRead).toBe(true);
  });

  it('rethrows unrelated AWS failures and unexplained conditional failures', async () => {
    const denied = Object.assign(new Error('denied'), { name: 'AccessDeniedException' });
    send.mockRejectedValueOnce(denied);
    await expect(
      new DynamoDbMinutesRepository().createVersion(
        meeting,
        'admin-1',
        { summary: 'x', discussion: '', decisions: [], actionItems: [], expectedVersion: 0 },
        1,
      ),
    ).rejects.toBe(denied);

    const conditional = Object.assign(new Error('conditional'), {
      name: 'ConditionalCheckFailedException',
    });
    send.mockRejectedValueOnce(conditional).mockResolvedValueOnce({ Items: [] });
    await expect(
      new DynamoDbMinutesRepository().createVersion(
        meeting,
        'admin-1',
        { summary: 'x', discussion: '', decisions: [], actionItems: [], expectedVersion: 0 },
        1,
      ),
    ).rejects.toBe(conditional);
  });

  it('rejects versions outside 1..999999 before writing', async () => {
    await expect(
      new DynamoDbMinutesRepository().createVersion(
        meeting,
        'admin-1',
        { summary: 'x', discussion: '', decisions: [], actionItems: [], expectedVersion: 999999 },
        1000000,
      ),
    ).rejects.toBeInstanceOf(RangeError);
    expect(send).not.toHaveBeenCalled();
  });
});

describe('minutesHandler', () => {
  beforeEach(() => {
    send.mockReset();
    getMeetingById.mockReset().mockResolvedValue(meeting);
    process.env.MEETING_DATA_TABLE = 'campusmeet-test-meeting-data';
    process.env.COLLABORATION_TABLE = 'campusmeet-test-collaboration';
  });

  it('returns a standard 401 envelope when JWT is missing', async () => {
    const missingJwt = authenticatedEvent('GET');
    delete (missingJwt.requestContext as { authorizer?: unknown }).authorizer;
    const unauthorized = (await minutesHandler(
      missingJwt,
      {} as never,
      vi.fn(),
    )) as APIGatewayProxyStructuredResultV2;
    expect(unauthorized).toMatchObject({ statusCode: 401 });
    expect(JSON.parse(unauthorized?.body ?? '{}')).toMatchObject({
      success: false,
      error: { code: 'UNAUTHORIZED' },
      requestId: 'test-request-id',
    });
  });

  it('returns the latest Minutes in the standard success envelope using the JWT actor', async () => {
    send
      .mockResolvedValueOnce({
        Item: {
          id: 'group-1:admin-1',
          groupId: 'group-1',
          userId: 'admin-1',
          role: 'GROUP_ADMIN',
          active: true,
          joinedAt: '2026-08-01T00:00:00.000Z',
        },
      })
      .mockResolvedValueOnce({ Items: [minutesItem] });
    const response = (await minutesHandler(
      authenticatedEvent('GET'),
      {} as never,
      vi.fn(),
    )) as APIGatewayProxyStructuredResultV2;
    expect(response).toMatchObject({ statusCode: 200 });
    expect(JSON.parse(response?.body ?? '{}')).toMatchObject({
      success: true,
      data: { meetingId: 'meeting-1', version: 1 },
      requestId: 'test-request-id',
    });
  });

  it('returns a standard 404 envelope when the meeting has no Minutes', async () => {
    send
      .mockResolvedValueOnce({
        Item: {
          id: 'group-1:admin-1',
          groupId: 'group-1',
          userId: 'admin-1',
          role: 'GROUP_ADMIN',
          active: true,
          joinedAt: '2026-08-01T00:00:00.000Z',
        },
      })
      .mockResolvedValueOnce({ Items: [] });
    const response = (await minutesHandler(
      authenticatedEvent('GET'),
      {} as never,
      vi.fn(),
    )) as APIGatewayProxyStructuredResultV2;
    expect(response.statusCode).toBe(404);
    expect(JSON.parse(response.body ?? '{}')).toMatchObject({
      success: false,
      error: { code: 'NOT_FOUND' },
      requestId: 'test-request-id',
    });
  });

  it('creates Minutes from the path meeting and JWT actor in the standard envelope', async () => {
    send
      .mockResolvedValueOnce({
        Item: {
          id: 'group-1:admin-1',
          groupId: 'group-1',
          userId: 'admin-1',
          role: 'GROUP_ADMIN',
          active: true,
          joinedAt: '2026-08-01T00:00:00.000Z',
        },
      })
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({});
    const event = authenticatedEvent('PUT');
    event.body = JSON.stringify({
      summary: 'Tóm tắt',
      discussion: '',
      decisions: [],
      actionItems: [],
      expectedVersion: 0,
    });
    const response = (await minutesHandler(
      event,
      {} as never,
      vi.fn(),
    )) as APIGatewayProxyStructuredResultV2;
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body ?? '{}') as { data: Record<string, unknown> };
    expect(body).toMatchObject({
      success: true,
      data: {
        meetingId: 'meeting-1',
        groupId: 'group-1',
        createdBy: 'admin-1',
        version: 1,
      },
      requestId: 'test-request-id',
    });
    const put = send.mock.calls[2]?.[0] as { input: { Item: Record<string, unknown> } };
    expect(put.input.Item).toMatchObject({
      PK: 'MEETING#meeting-1',
      meetingId: 'meeting-1',
      groupId: 'group-1',
      createdBy: 'admin-1',
    });
  });
});
