import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  GroupRole,
  GoogleSyncStatus,
  MeetingStatus,
  type Group,
  type Meeting,
} from '@campusmeet/shared';
import type {
  GroupRepository,
  MembershipAuthorizer,
  MeetingPage,
  MeetingRepository,
} from '../domain/ports';
import { MeetingError } from '../domain/meeting-errors';

type Item = Record<string, unknown>;
const client = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});
const required = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured`);
  return value;
};
const metaItem = (meeting: Meeting): Item => ({
  PK: `MEETING#${meeting.id}`,
  SK: 'META',
  entityType: 'Meeting',
  ...meeting,
  startAt: meeting.startsAt,
  endAt: meeting.endsAt,
  GSI1PK: `GROUP#${meeting.groupId}`,
  GSI1SK: `MEETING#${meeting.startsAt}#${meeting.id}`,
  GSI2PK: `USER#${meeting.organizerId}`,
  GSI2SK: `MEETING#${meeting.startsAt}#${meeting.id}`,
});
const fromMeta = (item: Item): Meeting => ({
  id: String(item.id),
  groupId: String(item.groupId),
  title: String(item.title),
  ...(item.description ? { description: String(item.description) } : {}),
  organizerId: String(item.organizerId),
  attendeeIds: Array.isArray(item.attendeeIds) ? item.attendeeIds.map(String) : [],
  agenda: [],
  startsAt: String(item.startsAt ?? item.startAt),
  endsAt: String(item.endsAt ?? item.endAt),
  status: item.status as MeetingStatus,
  googleSyncStatus:
    (item.googleSyncStatus as GoogleSyncStatus | undefined) ?? GoogleSyncStatus.NOT_REQUESTED,
  ...(item.meetUrl ? { meetUrl: String(item.meetUrl) } : {}),
  createdAt: String(item.createdAt),
  createdBy: String(item.createdBy),
  updatedAt: String(item.updatedAt),
  updatedBy: String(item.updatedBy),
  version: Number(item.version),
  ...(item.cancelledAt ? { cancelledAt: String(item.cancelledAt) } : {}),
  ...(item.cancelledBy ? { cancelledBy: String(item.cancelledBy) } : {}),
  ...(item.cancellationReason ? { cancellationReason: String(item.cancellationReason) } : {}),
});
const encodeCursor = (key?: Item) =>
  key ? Buffer.from(JSON.stringify(key), 'utf8').toString('base64url') : undefined;
const decodeCursor = (cursor?: string): Item | undefined => {
  if (!cursor) return undefined;
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value as Item;
  } catch {
    throw new MeetingError('VALIDATION_ERROR', 'Cursor không hợp lệ.');
  }
};
const mapAwsError = (error: unknown): never => {
  const name = error instanceof Error ? error.name : '';
  if (name === 'ConditionalCheckFailedException' || name === 'TransactionCanceledException')
    throw new MeetingError('CONFLICT', 'Dữ liệu cuộc họp đã thay đổi hoặc bị trùng.');
  throw error;
};

export class DynamoDbGroupRepository implements GroupRepository {
  constructor(
    private readonly db = client,
    private readonly table = required('COLLABORATION_TABLE'),
  ) {}
  async getById(id: string): Promise<Group | null> {
    const result = await this.db.send(
      new GetCommand({ TableName: this.table, Key: { PK: `GROUP#${id}`, SK: 'META' } }),
    );
    return result.Item ? (result.Item as unknown as Group) : null;
  }
}
export class DynamoDbMembershipAuthorizer implements MembershipAuthorizer {
  constructor(
    private readonly db = client,
    private readonly table = required('COLLABORATION_TABLE'),
  ) {}
  async getMembership(groupId: string, userId: string) {
    const result = await this.db.send(
      new GetCommand({
        TableName: this.table,
        Key: { PK: `GROUP#${groupId}`, SK: `MEMBER#${userId}` },
        ConsistentRead: true,
      }),
    );
    if (!result.Item) return null;
    return {
      groupId,
      userId,
      role: result.Item.role as GroupRole,
      active: result.Item.active === true || result.Item.status === 'ACTIVE',
    };
  }
}
export class DynamoDbMeetingRepository implements MeetingRepository {
  constructor(
    private readonly db = client,
    private readonly table = required('MEETING_DATA_TABLE'),
  ) {}
  async create(meeting: Meeting): Promise<Meeting> {
    const items = this.puts(meeting);
    if (items.length > 100)
      throw new MeetingError('VALIDATION_ERROR', 'Tổng attendee và agenda vượt giới hạn 99.');
    try {
      await this.db.send(new TransactWriteCommand({ TransactItems: items }));
      return meeting;
    } catch (error) {
      return mapAwsError(error);
    }
  }
  async getById(id: string) {
    const result = await this.db.send(
      new QueryCommand({
        TableName: this.table,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: { ':pk': `MEETING#${id}` },
        ConsistentRead: true,
      }),
    );
    const meta = result.Items?.find((i) => i.SK === 'META');
    if (!meta) return null;
    const meeting = fromMeta(meta);
    meeting.attendeeIds = (result.Items ?? [])
      .filter((i) => String(i.SK).startsWith('ATTENDEE#'))
      .map((i) => String(i.userId));
    meeting.agenda = (result.Items ?? [])
      .filter((i) => String(i.SK).startsWith('AGENDA#'))
      .map((i) => ({
        id: String(i.agendaItemId),
        order: Number(i.order),
        title: String(i.title),
        ...(i.description ? { description: String(i.description) } : {}),
      }))
      .sort((a, b) => a.order - b.order);
    return meeting;
  }
  async resolveGroupId(id: string) {
    const result = await this.db.send(
      new GetCommand({
        TableName: this.table,
        Key: { PK: `MEETING#${id}`, SK: 'META' },
        ProjectionExpression: 'groupId',
        ConsistentRead: true,
      }),
    );
    return result.Item?.groupId ? String(result.Item.groupId) : null;
  }
  async listByGroup(groupId: string, limit: number, cursor?: string): Promise<MeetingPage> {
    const result = await this.db.send(
      new QueryCommand({
        TableName: this.table,
        IndexName: 'GSI1',
        KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :prefix)',
        ExpressionAttributeValues: { ':pk': `GROUP#${groupId}`, ':prefix': 'MEETING#' },
        Limit: limit,
        ExclusiveStartKey: decodeCursor(cursor),
        ScanIndexForward: true,
      }),
    );
    return {
      items: (result.Items ?? []).map(fromMeta),
      ...(result.LastEvaluatedKey ? { nextCursor: encodeCursor(result.LastEvaluatedKey) } : {}),
    };
  }
  async update(meeting: Meeting, expectedVersion: number) {
    const existing = await this.db.send(
      new QueryCommand({
        TableName: this.table,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: { ':pk': `MEETING#${meeting.id}` },
        ProjectionExpression: 'PK, SK',
      }),
    );
    const puts = this.puts(meeting).slice(1);
    const desiredKeys = new Set(puts.map((operation) => String(operation.Put.Item.SK)));
    const deletes = (existing.Items ?? [])
      .filter((i) => String(i.SK).startsWith('ATTENDEE#') || String(i.SK).startsWith('AGENDA#'))
      .filter((i) => !desiredKeys.has(String(i.SK)))
      .map((i) => ({ Delete: { TableName: this.table, Key: { PK: i.PK, SK: i.SK } } }));
    const transactions = [
      {
        Put: {
          TableName: this.table,
          Item: metaItem(meeting),
          ConditionExpression: '#version = :version',
          ExpressionAttributeNames: { '#version': 'version' },
          ExpressionAttributeValues: { ':version': expectedVersion },
        },
      },
      ...deletes,
      ...puts,
    ];
    if (transactions.length > 100)
      throw new MeetingError(
        'VALIDATION_ERROR',
        'Tổng attendee và agenda vượt giới hạn transaction.',
      );
    try {
      await this.db.send(new TransactWriteCommand({ TransactItems: transactions }));
      return meeting;
    } catch (error) {
      return mapAwsError(error);
    }
  }
  async cancel(id: string, actorId: string, reason?: string, expectedVersion?: number) {
    const current = await this.getById(id);
    if (!current) throw new MeetingError('NOT_FOUND', 'Không tìm thấy cuộc họp.');
    if (current.status === MeetingStatus.CANCELLED) return current;
    if (current.status === MeetingStatus.COMPLETED)
      throw new MeetingError('VALIDATION_ERROR', 'Không thể hủy cuộc họp đã hoàn thành.');
    const now = new Date().toISOString();
    const values: Item = {
      ':cancelled': MeetingStatus.CANCELLED,
      ':completed': MeetingStatus.COMPLETED,
      ':now': now,
      ':actor': actorId,
      ':one': 1,
    };
    let condition = '#status <> :cancelled AND #status <> :completed';
    if (expectedVersion !== undefined) {
      condition += ' AND #version = :version';
      values[':version'] = expectedVersion;
    }
    try {
      await this.db.send(
        new UpdateCommand({
          TableName: this.table,
          Key: { PK: `MEETING#${id}`, SK: 'META' },
          UpdateExpression:
            'SET #status=:cancelled, cancelledAt=:now, cancelledBy=:actor, updatedAt=:now, updatedBy=:actor, #version=#version+:one' +
            (reason ? ', cancellationReason=:reason' : ''),
          ConditionExpression: condition,
          ExpressionAttributeNames: { '#status': 'status', '#version': 'version' },
          ExpressionAttributeValues: { ...values, ...(reason ? { ':reason': reason } : {}) },
        }),
      );
      return (await this.getById(id))!;
    } catch (error) {
      if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
        const latest = await this.getById(id);
        if (latest?.status === MeetingStatus.CANCELLED) return latest;
      }
      return mapAwsError(error);
    }
  }
  private puts(meeting: Meeting) {
    return [
      {
        Put: {
          TableName: this.table,
          Item: metaItem(meeting),
          ConditionExpression: 'attribute_not_exists(PK)',
        },
      },
      ...meeting.attendeeIds.map((userId) => ({
        Put: {
          TableName: this.table,
          Item: {
            PK: `MEETING#${meeting.id}`,
            SK: `ATTENDEE#${userId}`,
            entityType: 'MeetingAttendee',
            meetingId: meeting.id,
            groupId: meeting.groupId,
            userId,
          },
        },
      })),
      ...meeting.agenda.map((item) => ({
        Put: {
          TableName: this.table,
          Item: {
            PK: `MEETING#${meeting.id}`,
            SK: `AGENDA#${String(item.order).padStart(6, '0')}#${item.id}`,
            entityType: 'AgendaItem',
            meetingId: meeting.id,
            groupId: meeting.groupId,
            agendaItemId: item.id,
            order: item.order,
            title: item.title,
            description: item.description,
          },
        },
      })),
    ];
  }
}
