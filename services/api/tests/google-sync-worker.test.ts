import { describe, expect, it, vi } from 'vitest';
import {
  GoogleMeetingFailureClass,
  GoogleMeetingSyncStatus,
  GoogleSyncStatus,
  IntegrationStatus,
  MeetingStatus,
  type GoogleMeetingSyncRecord,
  type Meeting,
} from '@campusmeet/shared';
import { GoogleSyncWorker } from '../src/application/google-sync-worker';
import { GoogleProviderError } from '../src/integrations/adapters';
import { InMemoryMeetingRepository } from '../src/repositories/in-memory';
import { UnauthorizedError } from '../src/utils/errors';

const meeting: Meeting = {
  id: 'meeting-1',
  groupId: 'group-1',
  organizerId: 'organizer-1',
  title: 'Planning',
  attendeeIds: ['organizer-1'],
  agenda: [],
  startsAt: '2029-01-01T10:00:00.000Z',
  endsAt: '2029-01-01T11:00:00.000Z',
  status: MeetingStatus.SCHEDULED,
  googleSyncStatus: GoogleSyncStatus.NOT_REQUESTED,
  integrationStatus: IntegrationStatus.NOT_CONNECTED,
  createdAt: '2029-01-01T00:00:00.000Z',
  createdBy: 'organizer-1',
  updatedAt: '2029-01-01T00:00:00.000Z',
  updatedBy: 'organizer-1',
  version: 1,
};
const sync = (overrides: Partial<GoogleMeetingSyncRecord> = {}): GoogleMeetingSyncRecord => ({
  meetingId: meeting.id,
  groupId: meeting.groupId,
  organizerId: meeting.organizerId,
  provider: 'GOOGLE',
  syncStatus: GoogleMeetingSyncStatus.PENDING,
  syncRevision: 1,
  desiredMeetingVersion: 1,
  desiredMeetingStatus: MeetingStatus.SCHEDULED,
  attemptCount: 0,
  createdAt: meeting.createdAt,
  updatedAt: meeting.updatedAt,
  ...overrides,
});

const setup = async (record = sync()) => {
  const repository = new InMemoryMeetingRepository();
  await repository.create(meeting, record);
  const calendar = {
    ensureScheduledMeeting: vi.fn(async () => ({
      eventId: 'event-1',
      meetUrl: 'https://meet.google.com/abc-defg-hij',
    })),
    ensureCancelledMeeting: vi.fn(async () => undefined),
  };
  const scheduler = { schedule: vi.fn(async () => undefined) };
  const worker = new GoogleSyncWorker(
    repository,
    repository,
    calendar,
    scheduler,
    () => new Date('2029-01-01T00:00:00.000Z'),
  );
  return { repository, calendar, scheduler, worker };
};

describe('GoogleSyncWorker', () => {
  it('reconciles PENDING to SYNCED and stores trusted identity', async () => {
    const { worker, repository, calendar } = await setup();
    await worker.process({ meetingId: meeting.id, syncRevision: 1 }, 'request-1');
    expect(calendar.ensureScheduledMeeting).toHaveBeenCalledTimes(1);
    await expect(repository.get(meeting.id)).resolves.toMatchObject({
      syncStatus: 'SYNCED',
      googleEventId: 'event-1',
      meetUrl: 'https://meet.google.com/abc-defg-hij',
    });
  });

  it('does not call Google or schedule retry for stale/duplicate completed work', async () => {
    const { worker, calendar, scheduler } = await setup(sync({ syncRevision: 2 }));
    await worker.process({ meetingId: meeting.id, syncRevision: 1 }, 'request-1');
    expect(calendar.ensureScheduledMeeting).not.toHaveBeenCalled();
    expect(scheduler.schedule).not.toHaveBeenCalled();
  });

  it('maps a missing or revoked connection to ACTION_REQUIRED without retry', async () => {
    const { worker, repository, calendar, scheduler } = await setup();
    calendar.ensureScheduledMeeting.mockRejectedValue(new UnauthorizedError());
    await worker.process({ meetingId: meeting.id, syncRevision: 1 }, 'request-1');
    await expect(repository.get(meeting.id)).resolves.toMatchObject({
      syncStatus: 'ACTION_REQUIRED',
      failureClass: 'ACTION_REQUIRED',
      lastErrorCode: 'GOOGLE_CONNECTION_REQUIRED',
      attemptCount: 1,
    });
    expect(scheduler.schedule).not.toHaveBeenCalled();
  });

  it.each([
    [429, 60_000],
    [503, 60_000],
  ])('schedules retryable HTTP %s after one minute', async (status, delay) => {
    const { worker, repository, calendar, scheduler } = await setup();
    calendar.ensureScheduledMeeting.mockRejectedValue(new GoogleProviderError(status));
    await worker.process({ meetingId: meeting.id, syncRevision: 1 }, 'request-1');
    expect(scheduler.schedule).toHaveBeenCalledWith(
      expect.objectContaining({
        attemptCount: 1,
        runAt: new Date(Date.parse('2029-01-01T00:00:00.000Z') + delay).toISOString(),
      }),
    );
    await expect(repository.get(meeting.id)).resolves.toMatchObject({
      syncStatus: 'FAILED',
      failureClass: 'RETRYABLE',
      attemptCount: 1,
    });
  });

  it.each([
    [0, 60_000],
    [1, 5 * 60_000],
    [2, 15 * 60_000],
    [3, 60 * 60_000],
    [4, 6 * 60 * 60_000],
  ])('uses the accepted delay after %s completed attempts', async (completed, delay) => {
    const { worker, calendar, scheduler } = await setup(
      sync({
        syncStatus: completed ? GoogleMeetingSyncStatus.FAILED : GoogleMeetingSyncStatus.PENDING,
        attemptCount: completed,
        ...(completed ? { failureClass: GoogleMeetingFailureClass.RETRYABLE } : {}),
      }),
    );
    calendar.ensureScheduledMeeting.mockRejectedValue(new GoogleProviderError(503));
    await worker.process({ meetingId: meeting.id, syncRevision: 1 }, 'request-1');
    expect(scheduler.schedule).toHaveBeenCalledWith(
      expect.objectContaining({
        attemptCount: completed + 1,
        runAt: new Date(Date.parse('2029-01-01T00:00:00.000Z') + delay).toISOString(),
      }),
    );
  });

  it('stops after the fifth automatic retry and never schedules a seventh attempt', async () => {
    const { worker, repository, calendar, scheduler } = await setup(
      sync({
        syncStatus: GoogleMeetingSyncStatus.FAILED,
        attemptCount: 5,
        failureClass: GoogleMeetingFailureClass.RETRYABLE,
      }),
    );
    calendar.ensureScheduledMeeting.mockRejectedValue(new GoogleProviderError(503));
    await worker.process({ meetingId: meeting.id, syncRevision: 1 }, 'request-1');
    expect(scheduler.schedule).not.toHaveBeenCalled();
    await expect(repository.get(meeting.id)).resolves.toMatchObject({
      syncStatus: 'FAILED',
      attemptCount: 6,
    });
  });

  it('reconciles cancellation and treats adapter absence success as SYNCED', async () => {
    const { worker, repository, calendar } = await setup(
      sync({ desiredMeetingStatus: MeetingStatus.CANCELLED }),
    );
    await repository.cancel(
      meeting.id,
      'organizer-1',
      'done',
      1,
      sync({ desiredMeetingStatus: MeetingStatus.CANCELLED, syncRevision: 2 }),
      1,
    );
    await worker.process({ meetingId: meeting.id, syncRevision: 2 }, 'request-1');
    expect(calendar.ensureCancelledMeeting).toHaveBeenCalledTimes(1);
    await expect(repository.get(meeting.id)).resolves.toMatchObject({ syncStatus: 'SYNCED' });
  });
});
