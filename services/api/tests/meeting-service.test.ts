import { describe, expect, it } from 'vitest';
import { GroupRole, MeetingStatus, type CreateMeetingRequest } from '@campusmeet/shared';
import { MeetingService } from '../src/application/meeting-service';
import {
  InMemoryMeetingRepository,
  InMemoryMembershipAuthorizer,
} from '../src/repositories/in-memory';

const future = { startsAt: '2030-01-01T10:00:00.000Z', endsAt: '2030-01-01T11:00:00.000Z' };
const input = (): CreateMeetingRequest => ({
  groupId: 'g1',
  title: 'Planning',
  organizerId: 'admin',
  attendeeIds: ['member'],
  agenda: [{ order: 0, title: 'Goals' }],
  status: MeetingStatus.SCHEDULED,
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
    const created = await service.create(input(), 'admin');
    expect(created.createdBy).toBe('admin');
    expect((await service.detail(created.id, 'member')).agenda[0]?.title).toBe('Goals');
    expect((await service.list('g1', 'member')).items).toHaveLength(1);
  });
  it('từ chối end time không sau start time', async () => {
    const { service } = setup();
    await expect(
      service.create({ ...input(), endsAt: future.startsAt }, 'admin'),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
  it('từ chối organizer hoặc attendee không active', async () => {
    const { service } = setup();
    await expect(
      service.create({ ...input(), organizerId: 'outsider' }, 'admin'),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      service.create({ ...input(), attendeeIds: ['outsider'] }, 'admin'),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
  it('từ chối attendee trùng và user ngoài group', async () => {
    const { service } = setup();
    await expect(
      service.create({ ...input(), attendeeIds: ['member', 'member'] }, 'admin'),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(service.list('g1', 'outsider')).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
  it('resolve meetingId sang group trước authorization', async () => {
    const { service } = setup();
    await service.create(input(), 'admin');
    await expect(service.detail('meeting-1', 'outsider')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(await service.resolveMeetingGroup('meeting-1')).toBe('g1');
  });
  it('từ chối detail, update và cancel khi user chỉ là active member group khác', async () => {
    const { service } = setup();
    await service.create(input(), 'admin');
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
    const first = await service.create(input(), 'admin');
    const updated = await service.update(first.id, { title: 'Updated', version: 1 }, 'admin');
    expect(updated).toMatchObject({
      id: first.id,
      groupId: 'g1',
      createdBy: 'admin',
      title: 'Updated',
      version: 2,
    });
    await expect(
      service.update(first.id, { title: 'stale', version: 1 }, 'admin'),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });
  it('từ chối lifecycle invalid', async () => {
    const { service, repository } = setup();
    const first = await service.create(input(), 'admin');
    await repository.cancel(first.id, 'admin');
    await expect(
      service.update(first.id, { title: 'No', version: 2 }, 'admin'),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
  it('cancel hai lần idempotent và không hard delete', async () => {
    const { service, repository } = setup();
    const first = await service.create(input(), 'admin');
    const once = await service.cancel(first.id, 'admin', 'reason');
    const twice = await service.cancel(first.id, 'admin', 'other');
    expect(twice.version).toBe(once.version);
    expect((await repository.getById(first.id))?.status).toBe(MeetingStatus.CANCELLED);
  });
});
