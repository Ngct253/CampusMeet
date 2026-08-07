import { GoogleSyncFailureClass, type GoogleMeetingSyncRecord } from '@campusmeet/shared';
import type { GoogleMeetingSyncGateway, GoogleSyncRetrySchedulerGateway } from '../domain/ports';
import { DynamoDbGoogleMeetingSyncRepository } from '../repositories/google-meeting-sync';
import { DynamoDbMeetingRepository } from '../repositories/dynamodb';
import { UnauthorizedError } from '../utils/errors';

const retryDelaysMs = [60_000, 300_000, 900_000, 3_600_000, 21_600_000] as const;

export class GoogleSyncFailure extends Error {
  constructor(
    readonly failureClass: GoogleSyncFailureClass,
    readonly safeCode: string,
  ) {
    super(safeCode);
    this.name = 'GoogleSyncFailure';
  }
}

export class GoogleMeetingSyncService {
  constructor(
    private readonly meetings: Pick<DynamoDbMeetingRepository, 'getById'>,
    private readonly syncRecords: Pick<
      DynamoDbGoogleMeetingSyncRepository,
      'get' | 'beginAttempt' | 'markSynced' | 'markFailed'
    >,
    private readonly google: GoogleMeetingSyncGateway,
    private readonly retries: GoogleSyncRetrySchedulerGateway,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(meetingId: string, syncRevision: number) {
    const current = await this.syncRecords.get(meetingId);
    if (!current) throw new Error('GOOGLE_SYNC_RECORD_NOT_FOUND');
    if (syncRevision < current.syncRevision) {
      this.log('SYNC_STALE_NOOP', current);
      return { outcome: 'STALE' as const };
    }
    if (syncRevision > current.syncRevision) throw new Error('GOOGLE_SYNC_REVISION_AHEAD');

    const attempt = await this.syncRecords.beginAttempt(meetingId, syncRevision);
    if (!attempt) {
      this.log('SYNC_STALE_NOOP', current);
      return { outcome: 'STALE' as const };
    }
    const meeting = await this.meetings.getById(meetingId);
    if (!meeting) throw new Error('MEETING_NOT_FOUND');

    try {
      const google = await this.google.reconcile(meeting, attempt);
      await this.syncRecords.markSynced(meetingId, syncRevision, google);
      this.log('SYNC_SUCCESS', attempt);
      return { outcome: 'SYNCED' as const };
    } catch (error) {
      const failure = this.classify(error);
      const retryOrdinal = attempt.attemptCount;
      const delay =
        failure.failureClass === GoogleSyncFailureClass.RETRYABLE
          ? retryDelaysMs[retryOrdinal - 1]
          : undefined;
      const nextRetryAt = delay ? new Date(this.now().getTime() + delay).toISOString() : undefined;
      await this.syncRecords.markFailed(
        meetingId,
        syncRevision,
        failure.failureClass,
        failure.safeCode,
        nextRetryAt,
      );
      if (nextRetryAt) {
        await this.retries.scheduleRetry({
          meetingId,
          syncRevision,
          retryOrdinal,
          runAt: nextRetryAt,
        });
        this.log('SYNC_RETRY_SCHEDULED', attempt, failure.safeCode);
      } else {
        this.log(
          failure.failureClass === GoogleSyncFailureClass.ACTION_REQUIRED
            ? 'SYNC_ACTION_REQUIRED'
            : 'SYNC_FAILED_FINAL',
          attempt,
          failure.safeCode,
        );
      }
      return { outcome: 'FAILED' as const, failureClass: failure.failureClass };
    }
  }

  private classify(error: unknown) {
    if (error instanceof GoogleSyncFailure) return error;
    if (
      typeof error === 'object' &&
      error !== null &&
      'failureClass' in error &&
      'safeCode' in error
    ) {
      return new GoogleSyncFailure(
        (error as { failureClass: GoogleSyncFailureClass }).failureClass,
        String((error as { safeCode: unknown }).safeCode),
      );
    }
    if (error instanceof UnauthorizedError) {
      return new GoogleSyncFailure(
        GoogleSyncFailureClass.ACTION_REQUIRED,
        'GOOGLE_CONNECTION_REQUIRED',
      );
    }
    return new GoogleSyncFailure(GoogleSyncFailureClass.RETRYABLE, 'GOOGLE_TEMPORARY_FAILURE');
  }

  private log(event: string, sync: GoogleMeetingSyncRecord, errorCode?: string) {
    console.info(
      JSON.stringify({
        event,
        meetingId: sync.meetingId,
        groupId: sync.groupId,
        syncRevision: sync.syncRevision,
        attemptCount: sync.attemptCount,
        ...(errorCode ? { errorCode } : {}),
      }),
    );
  }
}
