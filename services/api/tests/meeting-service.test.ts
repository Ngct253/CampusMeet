import { describe, expect, it, vi } from 'vitest';
import { GroupRole, MeetingStatus, type CreateMeetingRequest } from '@campusmeet/shared';
import { MeetingService } from '../src/application/meeting-service';
import {
  InMemoryMeetingRepository,
  InMemoryMembershipAuthorizer,
} from '../src/repositories/in-memory';

const future = { startsAt: '2030-01-01T10:00:00.000Z', endsAt: '2030-01-01T11:00:00.000Z' };
const input = (): CreateMeetingRequest => ({
  title: 'Planning',
  attendeeIds: ['member'],
  agenda: [{ order: 0, title: 'Goals' }],
  ...future,
});
const setup = () => {
  const memberships = new InMemoryMembershipAuthorizer();
  memberships.add('g1', 'admin', GroupRole.GROUP_ADMIN);
  memberships.add('g1', 'member');
  memberships.add('g2', 'group-b-admin', GroupRole.GROUP_ADMIN);
  const repository = new InMemoryMeetingRepository();
  return {
    repository,
    memberships,
    service: new MeetingService(
      repository,
      memberships,
      () => new Date('2029-01-01T00:00:00Z'),
      () => 'meeting-1',
    ),
  };
};

describe('MeetingService', () => {
  it('tạo, đọc và list meeting cho active member', async () => {
    const { service } = setup();
    const created = await service.create('g1', 'admin', input());
    expect(created).toMatchObject({ createdBy: 'admin', organizerId: 'admin' });
    expect((await service.detail(created.id, 'member')).agenda[0]?.title).toBe('Goals');
    expect((await service.list('g1', 'member')).items).toHaveLength(1);
  });
  it('từ chối end time không sau start time', async () => {
    const { service } = setup();
    await expect(
      service.create('g1', 'admin', { ...input(), endsAt: future.startsAt }),
    ).rejects.toMatchObject({ code: 'UNPROCESSABLE_ENTITY' });
  });
  it('từ chối attendee không active', async () => {
    const { service } = setup();
    await expect(
      service.create('g1', 'admin', { ...input(), attendeeIds: ['outsider'] }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
  it('từ chối attendee trùng và user ngoài group', async () => {
    const { service } = setup();
    await expect(
      service.create('g1', 'admin', { ...input(), attendeeIds: ['member', 'member'] }),
    ).rejects.toMatchObject({ code: 'UNPROCESSABLE_ENTITY' });
    await expect(service.list('g1', 'outsider')).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
  it('resolve meetingId sang group trước authorization', async () => {
    const { service } = setup();
    await service.create('g1', 'admin', input());
    await expect(service.detail('meeting-1', 'outsider')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(await service.resolveMeetingGroup('meeting-1')).toBe('g1');
  });
  it('từ chối detail, update và cancel khi user chỉ là active member group khác', async () => {
    const { service } = setup();
    await service.create('g1', 'admin', input());
    await expect(service.detail('meeting-1', 'group-b-admin')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(
      service.update('meeting-1', { title: 'Cross group', version: 1 }, 'group-b-admin'),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.cancel('meeting-1', 'group-b-admin')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });
  it('update bảo toàn identity/audit create và kiểm tra version', async () => {
    const { service } = setup();
    const first = await service.create('g1', 'admin', input());
    const updated = await service.update(first.id, { title: 'Updated', version: 1 }, 'admin');
    expect(updated).toMatchObject({
      id: first.id,
      groupId: 'g1',
      createdBy: 'admin',
      organizerId: 'admin',
      title: 'Updated',
      version: 2,
    });
    await expect(
      service.update(first.id, { title: 'stale', version: 1 }, 'admin'),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await service.detail(first.id, 'admin')).toMatchObject({
      title: 'Updated',
      version: 2,
    });
  });
  it('từ chối lifecycle invalid', async () => {
    const { service, repository } = setup();
    const first = await service.create('g1', 'admin', input());
    await repository.cancel(first.id, 'admin');
    await expect(
      service.update(first.id, { title: 'No', version: 2 }, 'admin'),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });
  it('cancel hai lần idempotent và không hard delete', async () => {
    const { service, repository } = setup();
    const first = await service.create('g1', 'admin', input());
    const once = await service.cancel(first.id, 'admin', 'reason');
    const twice = await service.cancel(first.id, 'admin', 'other');
    expect(twice.version).toBe(once.version);
    expect((await repository.getById(first.id))?.status).toBe(MeetingStatus.CANCELLED);
  });

  it('persists a pending Google sync intent atomically without calling Google', async () => {
    const { repository, memberships } = setup();
    const service = new MeetingService(
      repository,
      memberships,
      () => new Date('2029-01-01T00:00:00Z'),
      () => 'meeting-google',
      undefined,
      undefined,
      repository,
    );
    await expect(service.create('g1', 'admin', input())).resolves.toMatchObject({ version: 1 });
    await expect(repository.get('meeting-google')).resolves.toMatchObject({
      syncStatus: 'PENDING',
      syncRevision: 1,
      desiredMeetingVersion: 1,
      attemptCount: 0,
    });
  });

  it('does not call Google in the synchronous create path', async () => {
    const { repository, memberships } = setup();
    const service = new MeetingService(
      repository,
      memberships,
      () => new Date('2029-01-01T00:00:00Z'),
      () => 'meeting-google-failed',
      {
        ensureScheduledMeeting: vi.fn(async () => {
          throw new Error('must not run');
        }),
        ensureCancelledMeeting: vi.fn(async () => undefined),
      },
      undefined,
      repository,
    );
    const created = await service.create('g1', 'admin', input());
    expect(created).toMatchObject({ version: 1 });
    expect(await repository.getById(created.id)).not.toBeNull();
  });

  it('increments syncRevision atomically on update and preserves organizer/version semantics', async () => {
    const { repository, memberships } = setup();
    const service = new MeetingService(
      repository,
      memberships,
      undefined,
      undefined,
      undefined,
      undefined,
      repository,
    );
    const created = await service.create('g1', 'admin', input(), 'meeting-revision');
    const updated = await service.update(created.id, { title: 'Updated', version: 1 }, 'admin');
    expect(updated).toMatchObject({ organizerId: 'admin', version: 2 });
    await expect(repository.get(created.id)).resolves.toMatchObject({
      syncRevision: 2,
      desiredMeetingVersion: 2,
      syncStatus: 'PENDING',
    });
  });

  it('persists cancellation and its desired sync revision together', async () => {
    const { repository, memberships } = setup();
    const service = new MeetingService(
      repository,
      memberships,
      undefined,
      undefined,
      undefined,
      undefined,
      repository,
    );
    const created = await service.create('g1', 'admin', input(), 'meeting-cancel-sync');
    const cancelled = await service.cancel(created.id, 'admin', 'done', 1);
    expect(cancelled).toMatchObject({ status: 'CANCELLED', version: 2 });
    await expect(repository.get(created.id)).resolves.toMatchObject({
      syncRevision: 2,
      desiredMeetingStatus: 'CANCELLED',
    });
  });

  it('allows only an active Group Admin to create a manual retry revision', async () => {
    const { repository, memberships } = setup();
    const service = new MeetingService(
      repository,
      memberships,
      undefined,
      undefined,
      undefined,
      undefined,
      repository,
    );
    await service.create('g1', 'admin', input(), 'meeting-manual-retry');
    await expect(service.retryGoogleSync('meeting-manual-retry', 'member')).rejects.toMatchObject({
      statusCode: 403,
    });
    await expect(service.retryGoogleSync('meeting-manual-retry', 'admin')).resolves.toEqual({
      provider: 'GOOGLE',
      status: 'PENDING',
    });
    await expect(repository.get('meeting-manual-retry')).resolves.toMatchObject({
      syncRevision: 2,
      attemptCount: 0,
    });
  });

  it('creates, reschedules, and cancels the one-time meeting reminder', async () => {
    const { repository, memberships } = setup();
    const reminders = {
      schedule: vi.fn(async () => ({ scheduleId: 'schedule-1' })),
      cancel: vi.fn(async () => undefined),
    };
    const service = new MeetingService(
      repository,
      memberships,
      () => new Date('2029-01-01T00:00:00Z'),
      () => 'meeting-reminder',
      undefined,
      reminders,
    );

    const created = await service.create('g1', 'admin', input());
    expect(reminders.schedule).toHaveBeenLastCalledWith(created);

    const updated = await service.update(
      created.id,
      { startsAt: '2030-01-01T12:00:00.000Z', endsAt: '2030-01-01T13:00:00.000Z', version: 1 },
      'admin',
    );
    expect(reminders.schedule).toHaveBeenLastCalledWith(updated);
    expect(reminders.schedule).toHaveBeenCalledTimes(2);

    await service.cancel(updated.id, 'admin', undefined, updated.version);
    expect(reminders.cancel).toHaveBeenCalledWith(updated.id);
  });

  it('keeps the persisted meeting when reminder scheduling fails', async () => {
    const { repository, memberships } = setup();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const service = new MeetingService(
      repository,
      memberships,
      () => new Date('2029-01-01T00:00:00Z'),
      () => 'meeting-reminder-failed',
      undefined,
      {
        schedule: async () => {
          throw new Error('Scheduler unavailable');
        },
        cancel: async () => undefined,
      },
    );

    await expect(service.create('g1', 'admin', input())).resolves.toMatchObject({
      id: 'meeting-reminder-failed',
    });
    expect(await repository.getById('meeting-reminder-failed')).not.toBeNull();
    expect(consoleError).toHaveBeenCalledWith(
      'Meeting reminder scheduling failed',
      expect.objectContaining({ meetingId: 'meeting-reminder-failed' }),
    );
    consoleError.mockRestore();
  });
});
