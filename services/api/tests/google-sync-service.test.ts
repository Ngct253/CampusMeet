import { describe, expect, it, vi } from 'vitest';
import {
  GoogleSyncFailureClass,
  GoogleSyncStatus,
  MeetingStatus,
  type GoogleMeetingSyncRecord,
  type Meeting,
} from '@campusmeet/shared';
import {
  GoogleMeetingSyncService,
  GoogleSyncFailure,
} from '../src/application/google-sync-service';

const meeting = {
  id: 'meeting-1',
  groupId: 'group-1',
  title: 'Planning',
  organizerId: 'admin',
  attendeeIds: ['admin'],
  agenda: [],
  startsAt: '2030-01-01T10:00:00.000Z',
  endsAt: '2030-01-01T11:00:00.000Z',
  status: MeetingStatus.SCHEDULED,
  googleSyncStatus: GoogleSyncStatus.PENDING,
  integrationStatus: 'PENDING',
  createdAt: '2029-01-01T00:00:00.000Z',
  createdBy: 'admin',
  updatedAt: '2029-01-01T00:00:00.000Z',
  updatedBy: 'admin',
  version: 1,
} as Meeting;

const record = {
  meetingId: meeting.id,
  groupId: meeting.groupId,
  organizerId: meeting.organizerId,
  provider: 'GOOGLE',
  syncStatus: GoogleSyncStatus.PENDING,
  syncRevision: 2,
  desiredMeetingVersion: 1,
  desiredMeetingStatus: meeting.status,
  attemptCount: 0,
  createdAt: meeting.createdAt,
  updatedAt: meeting.updatedAt,
} as GoogleMeetingSyncRecord;

const setup = (
  google = {
    reconcile: vi.fn(async () => ({ eventId: 'event-1', meetUrl: 'https://meet.google.com/a' })),
  },
) => {
  const syncRecords = {
    get: vi.fn(async () => record),
    beginAttempt: vi.fn(async () => ({ ...record, attemptCount: 1 })),
    markSynced: vi.fn(async () => undefined),
    markFailed: vi.fn(async () => undefined),
  };
  const retries = { scheduleRetry: vi.fn(async () => undefined) };
  const service = new GoogleMeetingSyncService(
    { getById: vi.fn(async () => meeting) },
    syncRecords,
    google,
    retries,
    () => new Date('2029-01-01T00:00:00.000Z'),
  );
  return { service, syncRecords, retries, google };
};

describe('GoogleMeetingSyncService', () => {
  it('ignores stale stream delivery without calling Google', async () => {
    const { service, syncRecords, google } = setup();
    await expect(service.execute(meeting.id, 1)).resolves.toEqual({ outcome: 'STALE' });
    expect(syncRecords.beginAttempt).not.toHaveBeenCalled();
    expect(google.reconcile).not.toHaveBeenCalled();
  });

  it('reconciles the current revision and conditionally marks it synced', async () => {
    const { service, syncRecords, google } = setup();
    await expect(service.execute(meeting.id, 2)).resolves.toEqual({ outcome: 'SYNCED' });
    expect(google.reconcile).toHaveBeenCalledWith(
      meeting,
      expect.objectContaining({ attemptCount: 1 }),
    );
    expect(syncRecords.markSynced).toHaveBeenCalledWith(meeting.id, 2, {
      eventId: 'event-1',
      meetUrl: 'https://meet.google.com/a',
    });
  });

  it('schedules bounded retry for a retryable failure', async () => {
    const google = {
      reconcile: vi.fn(async () => {
        throw new GoogleSyncFailure(GoogleSyncFailureClass.RETRYABLE, 'GOOGLE_RATE_LIMITED');
      }),
    };
    const { service, syncRecords, retries } = setup(google);
    await expect(service.execute(meeting.id, 2)).resolves.toMatchObject({ outcome: 'FAILED' });
    expect(syncRecords.markFailed).toHaveBeenCalledWith(
      meeting.id,
      2,
      GoogleSyncFailureClass.RETRYABLE,
      'GOOGLE_RATE_LIMITED',
      '2029-01-01T00:01:00.000Z',
    );
    expect(retries.scheduleRetry).toHaveBeenCalledWith({
      meetingId: meeting.id,
      syncRevision: 2,
      retryOrdinal: 1,
      runAt: '2029-01-01T00:01:00.000Z',
    });
  });

  it('does not retry an action-required failure', async () => {
    const google = {
      reconcile: vi.fn(async () => {
        throw new GoogleSyncFailure(
          GoogleSyncFailureClass.ACTION_REQUIRED,
          'GOOGLE_CONNECTION_REQUIRED',
        );
      }),
    };
    const { service, syncRecords, retries } = setup(google);
    await service.execute(meeting.id, 2);
    expect(syncRecords.markFailed).toHaveBeenCalledWith(
      meeting.id,
      2,
      GoogleSyncFailureClass.ACTION_REQUIRED,
      'GOOGLE_CONNECTION_REQUIRED',
      undefined,
    );
    expect(retries.scheduleRetry).not.toHaveBeenCalled();
  });
});
