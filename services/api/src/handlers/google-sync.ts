import type { DynamoDBStreamHandler, Handler } from 'aws-lambda';
import { GoogleMeetingSyncService } from '../application/google-sync-service';
import {
  GoogleMeetingSyncAdapter,
  GoogleSyncRetrySchedulerAdapter,
} from '../integrations/adapters';
import { DynamoDbMeetingRepository } from '../repositories/dynamodb';
import { DynamoDbGoogleMeetingSyncRepository } from '../repositories/google-meeting-sync';

type DirectGoogleSyncEvent = { meetingId: string; syncRevision: number };

const service = new GoogleMeetingSyncService(
  new DynamoDbMeetingRepository(),
  new DynamoDbGoogleMeetingSyncRepository(),
  new GoogleMeetingSyncAdapter(),
  new GoogleSyncRetrySchedulerAdapter(),
);

const execute = (event: DirectGoogleSyncEvent) =>
  service.execute(event.meetingId, event.syncRevision);

export const googleSyncHandler: Handler<
  DirectGoogleSyncEvent | Parameters<DynamoDBStreamHandler>[0]
> = async (event) => {
  if ('meetingId' in event) return execute(event);
  for (const record of event.Records) {
    const meetingId = record.dynamodb?.NewImage?.meetingId?.S;
    const revision = Number(record.dynamodb?.NewImage?.syncRevision?.N);
    if (meetingId && Number.isInteger(revision) && revision > 0) {
      await execute({ meetingId, syncRevision: revision });
    }
  }
  return { processed: event.Records.length };
};
