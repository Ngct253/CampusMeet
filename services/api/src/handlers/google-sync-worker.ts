import type { DynamoDBStreamHandler, Handler } from 'aws-lambda';
import { GoogleSyncWorker, type GoogleSyncWorkItem } from '../application/google-sync-worker';
import { GoogleCalendarAdapter, GoogleSyncSchedulerAdapter } from '../integrations/adapters';
import { DynamoDbMeetingRepository } from '../repositories/dynamodb';
import { DynamoDbGoogleMeetingSyncRepository } from '../repositories/google-meeting-sync';

const worker = new GoogleSyncWorker(
  new DynamoDbMeetingRepository(),
  new DynamoDbGoogleMeetingSyncRepository(),
  new GoogleCalendarAdapter(),
  new GoogleSyncSchedulerAdapter(),
);

const stringAttribute = (value: unknown) =>
  value && typeof value === 'object' && 'S' in value
    ? String((value as { S: string }).S)
    : undefined;
const numberAttribute = (value: unknown) =>
  value && typeof value === 'object' && 'N' in value
    ? Number((value as { N: string }).N)
    : undefined;

const parseDirect = (event: unknown): GoogleSyncWorkItem | undefined => {
  if (!event || typeof event !== 'object') return undefined;
  const value = event as Record<string, unknown>;
  return typeof value.meetingId === 'string' && Number.isInteger(value.syncRevision)
    ? { meetingId: value.meetingId, syncRevision: Number(value.syncRevision) }
    : undefined;
};

export const googleSyncWorkerHandler: Handler = async (event, context) => {
  const direct = parseDirect(event);
  if (direct) return worker.process(direct, context.awsRequestId);
  const records = (event as Parameters<DynamoDBStreamHandler>[0]).Records ?? [];
  for (const record of records) {
    const image = record.dynamodb?.NewImage;
    const meetingId = stringAttribute(image?.meetingId);
    const syncRevision = numberAttribute(image?.syncRevision);
    if (meetingId && Number.isInteger(syncRevision)) {
      await worker.process({ meetingId, syncRevision: syncRevision! }, context.awsRequestId);
    }
  }
};
