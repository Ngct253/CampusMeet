import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  GoogleMeetingSyncStatus,
  type GoogleMeetingSyncRecord,
  type Meeting,
} from '@campusmeet/shared';
import type { GoogleMeetingSyncRepository } from '../domain/ports';
import { MeetingError } from '../domain/meeting-errors';

type Item = Record<string, unknown>;
const client = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});
export const googleSyncKey = (meetingId: string) => ({
  PK: `MEETING#${meetingId}`,
  SK: 'INTEGRATION#GOOGLE',
});
export const googleSyncItem = (record: GoogleMeetingSyncRecord): Item => ({
  ...googleSyncKey(record.meetingId),
  entityType: 'GoogleMeetingSyncRecord',
  ...record,
});
const fromItem = (item: Item): GoogleMeetingSyncRecord => ({
  meetingId: String(item.meetingId),
  groupId: String(item.groupId),
  organizerId: String(item.organizerId),
  provider: 'GOOGLE',
  syncStatus: item.syncStatus as GoogleMeetingSyncRecord['syncStatus'],
  syncRevision: Number(item.syncRevision),
  desiredMeetingVersion: Number(item.desiredMeetingVersion),
  desiredMeetingStatus:
    item.desiredMeetingStatus as GoogleMeetingSyncRecord['desiredMeetingStatus'],
  ...(item.googleEventId ? { googleEventId: String(item.googleEventId) } : {}),
  ...(item.meetUrl ? { meetUrl: String(item.meetUrl) } : {}),
  attemptCount: Number(item.attemptCount),
  ...(item.failureClass
    ? { failureClass: item.failureClass as GoogleMeetingSyncRecord['failureClass'] }
    : {}),
  ...(item.lastErrorCode ? { lastErrorCode: String(item.lastErrorCode) } : {}),
  ...(item.lastErrorAt ? { lastErrorAt: String(item.lastErrorAt) } : {}),
  ...(item.nextRetryAt ? { nextRetryAt: String(item.nextRetryAt) } : {}),
  createdAt: String(item.createdAt),
  updatedAt: String(item.updatedAt),
});

export class DynamoDbGoogleMeetingSyncRepository implements GoogleMeetingSyncRepository {
  constructor(
    private readonly db = client,
    private readonly table = process.env.MEETING_DATA_TABLE ??
      '__UNCONFIGURED_MEETING_DATA_TABLE__',
  ) {}

  async get(meetingId: string) {
    const result = await this.db.send(
      new GetCommand({
        TableName: this.table,
        Key: googleSyncKey(meetingId),
        ConsistentRead: true,
      }),
    );
    return result.Item ? fromItem(result.Item) : null;
  }

  async createForLegacy(meeting: Meeting, now: string) {
    const record: GoogleMeetingSyncRecord = {
      meetingId: meeting.id,
      groupId: meeting.groupId,
      organizerId: meeting.organizerId,
      provider: 'GOOGLE',
      syncStatus: GoogleMeetingSyncStatus.PENDING,
      syncRevision: 1,
      desiredMeetingVersion: meeting.version,
      desiredMeetingStatus: meeting.status,
      ...(meeting.googleEventId ? { googleEventId: meeting.googleEventId } : {}),
      ...(meeting.meetUrl ? { meetUrl: meeting.meetUrl } : {}),
      attemptCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    try {
      await this.db.send(
        new PutCommand({
          TableName: this.table,
          Item: googleSyncItem(record),
          ConditionExpression: 'attribute_not_exists(PK)',
        }),
      );
      return record;
    } catch (error) {
      if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
        throw new MeetingError('CONFLICT', 'Google sync record đã được tạo.');
      }
      throw error;
    }
  }

  async markSuccess(
    meetingId: string,
    syncRevision: number,
    result: { googleEventId?: string; meetUrl?: string; attemptCount: number },
  ) {
    try {
      await this.db.send(
        new UpdateCommand({
          TableName: this.table,
          Key: googleSyncKey(meetingId),
          UpdateExpression:
            'SET syncStatus=:synced, attemptCount=:attempt, updatedAt=:now' +
            (result.googleEventId ? ', googleEventId=:eventId' : '') +
            (result.meetUrl ? ', meetUrl=:meetUrl' : '') +
            ' REMOVE failureClass, lastErrorCode, lastErrorAt, nextRetryAt',
          ConditionExpression: 'syncRevision=:revision',
          ExpressionAttributeValues: {
            ':synced': GoogleMeetingSyncStatus.SYNCED,
            ':now': new Date().toISOString(),
            ':revision': syncRevision,
            ':attempt': result.attemptCount,
            ...(result.googleEventId ? { ':eventId': result.googleEventId } : {}),
            ...(result.meetUrl ? { ':meetUrl': result.meetUrl } : {}),
          },
        }),
      );
      return true;
    } catch (error) {
      if (error instanceof Error && error.name === 'ConditionalCheckFailedException') return false;
      throw error;
    }
  }

  async markFailure(
    meetingId: string,
    syncRevision: number,
    failure: Parameters<GoogleMeetingSyncRepository['markFailure']>[2],
  ) {
    try {
      await this.db.send(
        new UpdateCommand({
          TableName: this.table,
          Key: googleSyncKey(meetingId),
          UpdateExpression:
            'SET syncStatus=:status, attemptCount=:attempt, failureClass=:class, lastErrorCode=:code, lastErrorAt=:at, updatedAt=:at' +
            (failure.nextRetryAt ? ', nextRetryAt=:next' : '') +
            (failure.nextRetryAt ? '' : ' REMOVE nextRetryAt'),
          ConditionExpression: 'syncRevision=:revision',
          ExpressionAttributeValues: {
            ':status': failure.status,
            ':attempt': failure.attemptCount,
            ':class': failure.failureClass,
            ':code': failure.lastErrorCode,
            ':at': failure.lastErrorAt,
            ':revision': syncRevision,
            ...(failure.nextRetryAt ? { ':next': failure.nextRetryAt } : {}),
          },
        }),
      );
      return true;
    } catch (error) {
      if (error instanceof Error && error.name === 'ConditionalCheckFailedException') return false;
      throw error;
    }
  }

  async manualRetry(meeting: Meeting, expectedSyncRevision: number, now: string) {
    const nextRevision = expectedSyncRevision + 1;
    try {
      const result = await this.db.send(
        new UpdateCommand({
          TableName: this.table,
          Key: googleSyncKey(meeting.id),
          UpdateExpression:
            'SET syncStatus=:pending, syncRevision=:next, desiredMeetingVersion=:version, desiredMeetingStatus=:meetingStatus, attemptCount=:zero, updatedAt=:now REMOVE failureClass, lastErrorCode, lastErrorAt, nextRetryAt',
          ConditionExpression: 'syncRevision=:expected',
          ExpressionAttributeValues: {
            ':pending': GoogleMeetingSyncStatus.PENDING,
            ':next': nextRevision,
            ':version': meeting.version,
            ':meetingStatus': meeting.status,
            ':zero': 0,
            ':now': now,
            ':expected': expectedSyncRevision,
          },
          ReturnValues: 'ALL_NEW',
        }),
      );
      return fromItem(result.Attributes!);
    } catch (error) {
      if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
        throw new MeetingError('CONFLICT', 'Google sync revision đã thay đổi.');
      }
      throw error;
    }
  }
}
