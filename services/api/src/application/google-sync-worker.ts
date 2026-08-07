import {
  GoogleMeetingFailureClass,
  GoogleMeetingSyncStatus,
  MeetingStatus,
  type GoogleMeetingSyncRecord,
} from '@campusmeet/shared';
import type {
  GoogleCalendarGateway,
  GoogleMeetingSyncRepository,
  GoogleSyncRetryScheduler,
  MeetingRepository,
} from '../domain/ports';
import { GoogleProviderError } from '../integrations/adapters';
import { ApiError } from '../utils/errors';
import { logger } from '../utils/logger';

export interface GoogleSyncWorkItem {
  meetingId: string;
  syncRevision: number;
}

const retryDelays = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000, 6 * 60 * 60_000];

const classify = (error: unknown) => {
  if (error instanceof ApiError && error.code === 'UNAUTHORIZED') {
    return {
      failureClass: GoogleMeetingFailureClass.ACTION_REQUIRED,
      code: 'GOOGLE_CONNECTION_REQUIRED',
    };
  }
  if (error instanceof GoogleProviderError) {
    if (
      error.status === 401 ||
      (error.status === 403 &&
        ['authError', 'insufficientPermissions'].includes(error.reason ?? ''))
    ) {
      return {
        failureClass: GoogleMeetingFailureClass.ACTION_REQUIRED,
        code: 'GOOGLE_AUTH_REQUIRED',
      };
    }
    if (
      error.status === 429 ||
      error.status >= 500 ||
      (error.status === 403 &&
        ['rateLimitExceeded', 'userRateLimitExceeded'].includes(error.reason ?? ''))
    ) {
      return {
        failureClass: GoogleMeetingFailureClass.RETRYABLE,
        code: `GOOGLE_HTTP_${error.status}`,
      };
    }
    return {
      failureClass: GoogleMeetingFailureClass.PERMANENT,
      code: `GOOGLE_HTTP_${error.status}`,
    };
  }
  const code = error instanceof Error ? error.name : 'UNKNOWN_ERROR';
  if (['AbortError', 'TimeoutError', 'TypeError'].includes(code)) {
    return {
      failureClass: GoogleMeetingFailureClass.RETRYABLE,
      code: `GOOGLE_${code.toUpperCase()}`,
    };
  }
  return { failureClass: GoogleMeetingFailureClass.PERMANENT, code: 'GOOGLE_RECONCILE_FAILED' };
};

export class GoogleSyncWorker {
  constructor(
    private readonly meetings: MeetingRepository,
    private readonly syncs: GoogleMeetingSyncRepository,
    private readonly calendar: GoogleCalendarGateway,
    private readonly scheduler: GoogleSyncRetryScheduler,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async process(work: GoogleSyncWorkItem, correlationId: string = crypto.randomUUID()) {
    const started = Date.now();
    const sync = await this.syncs.get(work.meetingId);
    if (!sync || work.syncRevision < sync.syncRevision) {
      this.event('SYNC_STALE_NOOP', sync, work, correlationId, started);
      return;
    }
    if (
      work.syncRevision > sync.syncRevision ||
      sync.syncStatus === GoogleMeetingSyncStatus.SYNCED ||
      sync.syncStatus === GoogleMeetingSyncStatus.ACTION_REQUIRED
    ) {
      this.event('SYNC_STALE_NOOP', sync, work, correlationId, started);
      return;
    }
    if (
      sync.syncStatus === GoogleMeetingSyncStatus.FAILED &&
      sync.nextRetryAt &&
      Date.parse(sync.nextRetryAt) > this.now().getTime()
    ) {
      this.event('SYNC_STALE_NOOP', sync, work, correlationId, started);
      return;
    }
    const meeting = await this.meetings.getById(work.meetingId);
    if (!meeting) {
      await this.finalFailure(
        sync,
        'MEETING_NOT_FOUND',
        GoogleMeetingFailureClass.PERMANENT,
        correlationId,
        started,
      );
      return;
    }
    const attemptCount = sync.attemptCount + 1;
    try {
      let result: { googleEventId?: string; meetUrl?: string; attemptCount: number } = {
        attemptCount,
      };
      if (meeting.status === MeetingStatus.CANCELLED) {
        await this.calendar.ensureCancelledMeeting(
          meeting,
          sync.googleEventId ?? meeting.googleEventId,
        );
      } else if (meeting.status === MeetingStatus.SCHEDULED) {
        const google = await this.calendar.ensureScheduledMeeting(meeting, {
          googleEventId: sync.googleEventId ?? meeting.googleEventId,
          meetUrl: sync.meetUrl ?? meeting.meetUrl,
        });
        result = {
          googleEventId: google.eventId,
          attemptCount,
          ...(google.meetUrl ? { meetUrl: google.meetUrl } : {}),
        };
      } else {
        throw new Error('UNSUPPORTED_MEETING_STATUS');
      }
      const written = await this.syncs.markSuccess(meeting.id, sync.syncRevision, result);
      if (!written) {
        this.event('SYNC_STALE_NOOP', sync, work, correlationId, started);
        return;
      }
      this.event('SYNC_SUCCESS', { ...sync, attemptCount }, work, correlationId, started);
    } catch (error) {
      const failure = classify(error);
      const at = this.now();
      if (failure.failureClass === GoogleMeetingFailureClass.ACTION_REQUIRED) {
        const written = await this.syncs.markFailure(meeting.id, sync.syncRevision, {
          status: GoogleMeetingSyncStatus.ACTION_REQUIRED,
          attemptCount,
          failureClass: failure.failureClass,
          lastErrorCode: failure.code,
          lastErrorAt: at.toISOString(),
        });
        if (!written) {
          this.event('SYNC_STALE_NOOP', sync, work, correlationId, started);
          return;
        }
        this.event(
          'SYNC_ACTION_REQUIRED',
          { ...sync, attemptCount, failureClass: failure.failureClass },
          work,
          correlationId,
          started,
          failure.code,
        );
        return;
      }
      const delay = retryDelays[attemptCount - 1];
      if (failure.failureClass === GoogleMeetingFailureClass.RETRYABLE && delay !== undefined) {
        const nextRetryAt = new Date(at.getTime() + delay).toISOString();
        const written = await this.syncs.markFailure(meeting.id, sync.syncRevision, {
          status: GoogleMeetingSyncStatus.FAILED,
          attemptCount,
          failureClass: failure.failureClass,
          lastErrorCode: failure.code,
          lastErrorAt: at.toISOString(),
          nextRetryAt,
        });
        if (written) {
          await this.scheduler.schedule({
            meetingId: meeting.id,
            syncRevision: sync.syncRevision,
            attemptCount,
            runAt: nextRetryAt,
          });
          this.event(
            'SYNC_RETRY_SCHEDULED',
            { ...sync, attemptCount, failureClass: failure.failureClass },
            work,
            correlationId,
            started,
            failure.code,
          );
        }
        return;
      }
      await this.finalFailure(
        sync,
        failure.code,
        failure.failureClass,
        correlationId,
        started,
        attemptCount,
      );
    }
  }

  private async finalFailure(
    sync: GoogleMeetingSyncRecord,
    code: string,
    failureClass: GoogleMeetingFailureClass,
    correlationId: string,
    started: number,
    attemptCount = sync.attemptCount,
  ) {
    const written = await this.syncs.markFailure(sync.meetingId, sync.syncRevision, {
      status: GoogleMeetingSyncStatus.FAILED,
      attemptCount,
      failureClass,
      lastErrorCode: code,
      lastErrorAt: this.now().toISOString(),
    });
    if (!written) {
      this.event(
        'SYNC_STALE_NOOP',
        sync,
        { meetingId: sync.meetingId, syncRevision: sync.syncRevision },
        correlationId,
        started,
      );
      return;
    }
    this.event(
      'SYNC_FAILED_FINAL',
      { ...sync, attemptCount, failureClass },
      { meetingId: sync.meetingId, syncRevision: sync.syncRevision },
      correlationId,
      started,
      code,
    );
  }

  private event(
    name: string,
    sync: GoogleMeetingSyncRecord | null,
    work: GoogleSyncWorkItem,
    correlationId: string,
    started: number,
    errorCode?: string,
  ) {
    logger.info(name, {
      correlationId,
      meetingId: work.meetingId,
      ...(sync?.groupId ? { groupId: sync.groupId } : {}),
      syncRevision: work.syncRevision,
      attemptCount: sync?.attemptCount ?? 0,
      desiredState: sync?.desiredMeetingStatus,
      syncStatus: sync?.syncStatus,
      failureClass: sync?.failureClass,
      ...(errorCode ? { errorCode } : {}),
      latencyMs: Date.now() - started,
      [name]: 1,
      _aws: {
        Timestamp: Date.now(),
        CloudWatchMetrics: [
          {
            Namespace: 'CampusMeet/GoogleSync',
            Dimensions: [[]],
            Metrics: [{ Name: name, Unit: 'Count' }],
          },
        ],
      },
    });
  }
}
