import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  GoogleSyncStatus,
  IntegrationStatus,
  MeetingStatus,
  type Group,
  type Meeting,
} from '@campusmeet/shared';
import type { GroupRepository, MeetingPage, MeetingRepository } from '../domain/ports';
import { MeetingError } from '../domain/meeting-errors';

type Item = Record<string, unknown>;
const client = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});
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
  integrationStatus:
    (item.integrationStatus as IntegrationStatus | undefined) ?? IntegrationStatus.NOT_CONNECTED,
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
type MeetingCursor = { v: 1; groupId: string; startsAt: string; meetingId: string };
const encodeCursor = (groupId: string, key?: Item) => {
  if (!key) return undefined;
  const match = /^MEETING#(.+)#([^#]+)$/.exec(String(key.GSI1SK ?? ''));
  if (!match || key.GSI1PK !== `GROUP#${groupId}` || key.PK !== `MEETING#${match[2]}`) {
    throw new MeetingError('VALIDATION_ERROR', 'KhÃ´ng thá»ƒ táº¡o cursor cuá»™c há»p.');
  }
  const value: MeetingCursor = { v: 1, groupId, startsAt: match[1]!, meetingId: match[2]! };
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
};
const decodeCursor = (groupId: string, cursor?: string): Item | undefined => {
  if (!cursor) return undefined;
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(cursor)) throw new Error();
    const value = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf8'),
    ) as Partial<MeetingCursor>;
    if (
      value.v !== 1 ||
      value.groupId !== groupId ||
      typeof value.startsAt !== 'string' ||
      !Number.isFinite(Date.parse(value.startsAt)) ||
      typeof value.meetingId !== 'string' ||
      !value.meetingId ||
      value.meetingId.includes('#')
    )
      throw new Error();
    return {
      PK: `MEETING#${value.meetingId}`,
      SK: 'META',
      GSI1PK: `GROUP#${groupId}`,
      GSI1SK: `MEETING#${value.startsAt}#${value.meetingId}`,
    };
  } catch {
    throw new MeetingError(
      'VALIDATION_ERROR',
      'Cursor khÃ´ng há»£p lá»‡ hoáº·c khÃ´ng thuá»™c nhÃ³m.',
    );
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
    private readonly table = process.env.COLLABORATION_TABLE ??
      '__UNCONFIGURED_COLLABORATION_TABLE__',
  ) {}
  async getById(id: string): Promise<Group | null> {
    const result = await this.db.send(
      new GetCommand({ TableName: this.table, Key: { PK: `GROUP#${id}`, SK: 'META' } }),
    );
    return result.Item ? (result.Item as unknown as Group) : null;
  }
}
export class DynamoDbMeetingRepository implements MeetingRepository {
  constructor(
    private readonly db = client,
    private readonly table = process.env.MEETING_DATA_TABLE ??
      '__UNCONFIGURED_MEETING_DATA_TABLE__',
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
  async listByGroup(groupId: string, limit = 20, cursor?: string): Promise<MeetingPage> {
    const result = await this.db.send(
      new QueryCommand({
        TableName: this.table,
        IndexName: 'GSI1',
        KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :prefix)',
        ExpressionAttributeValues: { ':pk': `GROUP#${groupId}`, ':prefix': 'MEETING#' },
        Limit: limit,
        ExclusiveStartKey: decodeCursor(groupId, cursor),
        ScanIndexForward: true,
      }),
    );
    return {
      items: (result.Items ?? []).map(fromMeta),
      ...(result.LastEvaluatedKey
        ? { nextCursor: encodeCursor(groupId, result.LastEvaluatedKey) }
        : {}),
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
