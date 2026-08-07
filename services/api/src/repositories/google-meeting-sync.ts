import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import {
  GoogleSyncFailureClass,
  GoogleSyncStatus,
  type GoogleMeetingSyncRecord,
  type Meeting,
} from '@campusmeet/shared';
import { ConflictError, ResourceNotFoundError } from '../utils/errors';

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});
const key = (meetingId: string) => ({
  PK: `MEETING#${meetingId}`,
  SK: 'INTEGRATION#GOOGLE',
});

export class DynamoDbGoogleMeetingSyncRepository {
  constructor(
    private readonly db = client,
    private readonly table = process.env.MEETING_DATA_TABLE ??
      '__UNCONFIGURED_MEETING_DATA_TABLE__',
    private readonly now: () => Date = () => new Date(),
  ) {}

  async get(meetingId: string): Promise<GoogleMeetingSyncRecord | null> {
    const result = await this.db.send(
      new GetCommand({ TableName: this.table, Key: key(meetingId), ConsistentRead: true }),
    );
    return result.Item ? (result.Item as GoogleMeetingSyncRecord) : null;
  }

  async beginAttempt(meetingId: string, syncRevision: number) {
    try {
      const result = await this.db.send(
        new UpdateCommand({
          TableName: this.table,
          Key: key(meetingId),
          UpdateExpression:
            'SET attemptCount = if_not_exists(attemptCount, :zero) + :one, syncStatus = :pending, updatedAt = :now REMOVE nextRetryAt',
          ConditionExpression:
            'syncRevision = :revision AND (syncStatus = :pending OR syncStatus = :failed)',
          ExpressionAttributeValues: {
            ':zero': 0,
            ':one': 1,
            ':now': this.now().toISOString(),
            ':revision': syncRevision,
            ':pending': GoogleSyncStatus.PENDING,
            ':failed': GoogleSyncStatus.FAILED,
          },
          ReturnValues: 'ALL_NEW',
        }),
      );
      return result.Attributes as GoogleMeetingSyncRecord;
    } catch (error) {
      if (error instanceof Error && error.name === 'ConditionalCheckFailedException') return null;
      throw error;
    }
  }

  async markSynced(
    meetingId: string,
    syncRevision: number,
    google: { eventId: string; meetUrl?: string },
  ) {
    await this.updateCurrent(
      meetingId,
      syncRevision,
      `SET syncStatus=:status, googleEventId=:eventId${
        google.meetUrl ? ', meetUrl=:meetUrl' : ''
      }, updatedAt=:now REMOVE failureClass, lastErrorCode, lastErrorAt, nextRetryAt${
        google.meetUrl ? '' : ', meetUrl'
      }`,
      {
        ':status': GoogleSyncStatus.SYNCED,
        ':eventId': google.eventId,
        ...(google.meetUrl ? { ':meetUrl': google.meetUrl } : {}),
      },
    );
  }

  async markFailed(
    meetingId: string,
    syncRevision: number,
    failureClass: GoogleSyncFailureClass,
    errorCode: string,
    nextRetryAt?: string,
  ) {
    const actionRequired = failureClass === GoogleSyncFailureClass.ACTION_REQUIRED;
    await this.updateCurrent(
      meetingId,
      syncRevision,
      `SET syncStatus=:status, failureClass=:failureClass, lastErrorCode=:errorCode, lastErrorAt=:now, updatedAt=:now${
        nextRetryAt ? ', nextRetryAt=:nextRetryAt' : ''
      }${nextRetryAt ? '' : ' REMOVE nextRetryAt'}`,
      {
        ':status': actionRequired ? GoogleSyncStatus.ACTION_REQUIRED : GoogleSyncStatus.FAILED,
        ':failureClass': failureClass,
        ':errorCode': errorCode,
        ...(nextRetryAt ? { ':nextRetryAt': nextRetryAt } : {}),
      },
    );
  }

  async retry(meeting: Meeting) {
    const current = await this.get(meeting.id);
    if (!current) throw new ResourceNotFoundError('Không tìm thấy trạng thái đồng bộ Google.');
    if (
      current.syncStatus !== GoogleSyncStatus.FAILED &&
      current.syncStatus !== GoogleSyncStatus.ACTION_REQUIRED
    ) {
      throw new ConflictError('Trạng thái đồng bộ Google hiện tại không thể retry.');
    }
    try {
      const result = await this.db.send(
        new UpdateCommand({
          TableName: this.table,
          Key: key(meeting.id),
          UpdateExpression:
            'SET syncStatus=:pending, syncRevision=syncRevision+:one, desiredMeetingVersion=:version, desiredMeetingStatus=:meetingStatus, attemptCount=:zero, updatedAt=:now REMOVE failureClass, lastErrorCode, lastErrorAt, nextRetryAt',
          ConditionExpression:
            'syncRevision = :currentRevision AND (syncStatus = :failed OR syncStatus = :actionRequired)',
          ExpressionAttributeValues: {
            ':pending': GoogleSyncStatus.PENDING,
            ':one': 1,
            ':version': meeting.version,
            ':meetingStatus': meeting.status,
            ':zero': 0,
            ':failed': GoogleSyncStatus.FAILED,
            ':actionRequired': GoogleSyncStatus.ACTION_REQUIRED,
            ':currentRevision': current.syncRevision,
            ':now': this.now().toISOString(),
          },
          ReturnValues: 'ALL_NEW',
        }),
      );
      return result.Attributes as GoogleMeetingSyncRecord;
    } catch (error) {
      if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
        throw new ConflictError('Revision đồng bộ Google đã thay đổi.');
      }
      throw error;
    }
  }

  private async updateCurrent(
    meetingId: string,
    syncRevision: number,
    updateExpression: string,
    values: Record<string, unknown>,
  ) {
    try {
      await this.db.send(
        new UpdateCommand({
          TableName: this.table,
          Key: key(meetingId),
          UpdateExpression: updateExpression,
          ConditionExpression: 'syncRevision = :revision',
          ExpressionAttributeValues: {
            ...values,
            ':revision': syncRevision,
            ':now': this.now().toISOString(),
          },
        }),
      );
    } catch (error) {
      if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
        throw new ConflictError('Revision đồng bộ Google đã thay đổi.');
      }
      throw error;
    }
  }
}
