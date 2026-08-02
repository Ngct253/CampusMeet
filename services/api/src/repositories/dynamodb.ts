import { createHash } from 'node:crypto';
import { GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import {
  IntegrationStatus,
  MeetingStatus,
  type CreateMeetingRequest,
  type Meeting,
} from '@campusmeet/shared';
import type { MeetingRepository } from '../domain/ports';
import { ConflictError, ResourceNotFoundError } from '../utils/errors';
import { documentClient, stringValue, tableName, type DynamoItem } from './client';

const toMeeting = (item: DynamoItem): Meeting | undefined => {
  const id = stringValue(item, 'id') ?? stringValue(item, 'PK')?.replace(/^MEETING#/, '');
  const groupId = stringValue(item, 'groupId');
  const title = stringValue(item, 'title');
  const organizerId = stringValue(item, 'organizerId');
  const startsAt = stringValue(item, 'startsAt');
  const endsAt = stringValue(item, 'endsAt');
  const status = stringValue(item, 'status') as MeetingStatus | undefined;
  const integrationStatus = stringValue(item, 'integrationStatus') as IntegrationStatus | undefined;
  if (
    !id ||
    !groupId ||
    !title ||
    !organizerId ||
    !startsAt ||
    !endsAt ||
    !status ||
    !integrationStatus
  ) {
    return undefined;
  }
  return {
    id,
    groupId,
    title,
    ...(stringValue(item, 'description') ? { description: stringValue(item, 'description') } : {}),
    organizerId,
    attendeeIds: Array.isArray(item.attendeeIds)
      ? item.attendeeIds.filter((value): value is string => typeof value === 'string')
      : [],
    startsAt,
    endsAt,
    status,
    integrationStatus,
    ...(stringValue(item, 'meetUrl') ? { meetUrl: stringValue(item, 'meetUrl') } : {}),
  };
};

const meetingItem = (meeting: Meeting) => ({
  PK: `MEETING#${meeting.id}`,
  SK: 'META',
  entityType: 'MEETING',
  ...meeting,
  GSI1PK: `GROUP#${meeting.groupId}`,
  GSI1SK: `MEETING#${meeting.startsAt}#${meeting.id}`,
  GSI2PK: `USER#${meeting.organizerId}`,
  GSI2SK: `MEETING#${meeting.startsAt}#${meeting.id}`,
});

export class DynamoDbMeetingRepository implements MeetingRepository {
  async getById(id: string): Promise<Meeting | null> {
    const result = await documentClient.send(
      new GetCommand({
        TableName: tableName('MEETING_TABLE'),
        Key: { PK: `MEETING#${id}`, SK: 'META' },
      }),
    );
    return result.Item ? (toMeeting(result.Item) ?? null) : null;
  }

  async listByGroup(groupId: string): Promise<Meeting[]> {
    const meetings: Meeting[] = [];
    let exclusiveStartKey: Record<string, unknown> | undefined;
    do {
      const page = await documentClient.send(
        new QueryCommand({
          TableName: tableName('MEETING_TABLE'),
          IndexName: 'GSI1',
          KeyConditionExpression: 'GSI1PK = :group AND begins_with(GSI1SK, :meeting)',
          ExpressionAttributeValues: { ':group': `GROUP#${groupId}`, ':meeting': 'MEETING#' },
          ExclusiveStartKey: exclusiveStartKey,
        }),
      );
      meetings.push(
        ...(page.Items ?? []).flatMap((item) => {
          const meeting = toMeeting(item);
          return meeting ? [meeting] : [];
        }),
      );
      exclusiveStartKey = page.LastEvaluatedKey;
    } while (exclusiveStartKey);
    return meetings;
  }

  async create(
    groupId: string,
    organizerId: string,
    input: CreateMeetingRequest,
    idempotencyKey: string,
  ): Promise<Meeting> {
    const id = createHash('sha256')
      .update(`${organizerId}:${idempotencyKey}`)
      .digest('hex')
      .slice(0, 32);
    const meeting: Meeting = {
      id,
      groupId,
      title: input.title,
      ...(input.description ? { description: input.description } : {}),
      organizerId,
      attendeeIds: [...new Set([organizerId, ...input.attendeeIds])],
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      status: MeetingStatus.SCHEDULED,
      integrationStatus: IntegrationStatus.NOT_CONNECTED,
    };
    try {
      await documentClient.send(
        new PutCommand({
          TableName: tableName('MEETING_TABLE'),
          Item: meetingItem(meeting),
          ConditionExpression: 'attribute_not_exists(PK)',
        }),
      );
      return meeting;
    } catch (error) {
      const existing = await this.getById(id);
      if (existing) return existing;
      throw error;
    }
  }

  async update(id: string, meeting: Meeting): Promise<Meeting> {
    try {
      const result = await documentClient.send(
        new UpdateCommand({
          TableName: tableName('MEETING_TABLE'),
          Key: { PK: `MEETING#${id}`, SK: 'META' },
          UpdateExpression:
            'SET #title = :title, #description = :description, attendeeIds = :attendees, startsAt = :startsAt, endsAt = :endsAt, GSI1SK = :gsi1, GSI2SK = :gsi2, updatedAt = :updatedAt',
          ConditionExpression: 'attribute_exists(PK) AND #status <> :cancelled',
          ExpressionAttributeNames: {
            '#title': 'title',
            '#description': 'description',
            '#status': 'status',
          },
          ExpressionAttributeValues: {
            ':title': meeting.title,
            ':description': meeting.description ?? null,
            ':attendees': meeting.attendeeIds,
            ':startsAt': meeting.startsAt,
            ':endsAt': meeting.endsAt,
            ':gsi1': `MEETING#${meeting.startsAt}#${id}`,
            ':gsi2': `MEETING#${meeting.startsAt}#${id}`,
            ':updatedAt': new Date().toISOString(),
            ':cancelled': MeetingStatus.CANCELLED,
          },
          ReturnValues: 'ALL_NEW',
        }),
      );
      const updated = result.Attributes && toMeeting(result.Attributes);
      if (!updated) throw new ResourceNotFoundError('Không tìm thấy cuộc họp.');
      return updated;
    } catch (error) {
      if ((error as { name?: string }).name === 'ConditionalCheckFailedException') {
        if (await this.getById(id)) throw new ConflictError('Cuộc họp đã bị hủy.');
        throw new ResourceNotFoundError('Không tìm thấy cuộc họp.');
      }
      throw error;
    }
  }

  async cancel(id: string, reason?: string): Promise<Meeting> {
    try {
      const result = await documentClient.send(
        new UpdateCommand({
          TableName: tableName('MEETING_TABLE'),
          Key: { PK: `MEETING#${id}`, SK: 'META' },
          UpdateExpression:
            'SET #status = :cancelled, cancelReason = :reason, updatedAt = :updatedAt',
          ConditionExpression: 'attribute_exists(PK)',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: {
            ':cancelled': MeetingStatus.CANCELLED,
            ':reason': reason ?? null,
            ':updatedAt': new Date().toISOString(),
          },
          ReturnValues: 'ALL_NEW',
        }),
      );
      const cancelled = result.Attributes && toMeeting(result.Attributes);
      if (!cancelled) throw new ResourceNotFoundError('Không tìm thấy cuộc họp.');
      return cancelled;
    } catch (error) {
      if ((error as { name?: string }).name === 'ConditionalCheckFailedException') {
        throw new ResourceNotFoundError('Không tìm thấy cuộc họp.');
      }
      throw error;
    }
  }
}
