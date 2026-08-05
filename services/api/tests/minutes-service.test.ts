import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GroupRole,
  IntegrationStatus,
  MeetingStatus,
  type Meeting,
  type MeetingMinutes,
  type UpdateMeetingMinutesRequest,
} from '@campusmeet/shared';
import { MinutesService } from '../src/services/minutes-service';

const meeting: Meeting = {
  id: 'meeting-1',
  groupId: 'group-1',
  title: 'Họp tuần',
  organizerId: 'admin-1',
  attendeeIds: ['admin-1', 'user-1'],
  startsAt: '2026-08-04T01:00:00.000Z',
  endsAt: '2026-08-04T02:00:00.000Z',
  status: MeetingStatus.COMPLETED,
  integrationStatus: IntegrationStatus.READY,
};
const input: UpdateMeetingMinutesRequest = {
  summary: 'Tóm tắt',
  discussion: '',
  decisions: [{ content: 'Quyết định' }],
  actionItems: [{ content: 'Hành động', assigneeId: 'user-1' }],
  expectedVersion: 0,
};
const saved: MeetingMinutes = {
  id: 'minutes-1',
  meetingId: meeting.id,
  groupId: meeting.groupId,
  summary: input.summary,
  discussion: input.discussion,
  decisions: [{ id: 'decision-1', content: 'Quyết định' }],
  actionItems: [{ id: 'action-1', content: 'Hành động', assigneeId: 'user-1' }],
  version: 1,
  createdBy: 'admin-1',
  createdAt: '2026-08-04T03:00:00.000Z',
};

const dependencies = () => {
  const minutes = {
    getLatest: vi.fn().mockResolvedValue(null),
    createVersion: vi.fn().mockResolvedValue(saved),
  };
  const meetings = { getById: vi.fn().mockResolvedValue(meeting) };
  const groups = {
    getMembership: vi
      .fn()
      .mockImplementation((_groupId: string, userId: string) =>
        Promise.resolve(
          userId === 'admin-1'
            ? { userId, role: GroupRole.GROUP_ADMIN, active: true }
            : userId === 'user-1'
              ? { userId, role: GroupRole.MEMBER, active: true }
              : undefined,
        ),
      ),
  };
  return { minutes, meetings, groups };
};

describe('MinutesService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 404 before membership lookup when the meeting does not exist', async () => {
    const deps = dependencies();
    deps.meetings.getById.mockResolvedValue(null);
    await expect(
      new MinutesService(deps.minutes, deps.meetings, deps.groups).getLatest('user-1', 'missing'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', statusCode: 404 });
    expect(deps.groups.getMembership).not.toHaveBeenCalled();
  });

  it('allows an active member to read and returns 404 when no Minutes exist', async () => {
    const { minutes, meetings, groups } = dependencies();
    const service = new MinutesService(minutes, meetings, groups);
    await expect(service.getLatest('user-1', meeting.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
      statusCode: 404,
    });
    minutes.getLatest.mockResolvedValue(saved);
    await expect(service.getLatest('user-1', meeting.id)).resolves.toEqual(saved);
  });

  it('rejects persisted Minutes whose group does not match the persisted meeting', async () => {
    const { minutes, meetings, groups } = dependencies();
    minutes.getLatest.mockResolvedValue({ ...saved, groupId: 'other-group' });
    const service = new MinutesService(minutes, meetings, groups);
    await expect(service.getLatest('user-1', meeting.id)).rejects.toThrow(
      'Malformed meeting minutes item.',
    );
    await expect(service.update('admin-1', meeting.id, input)).rejects.toThrow(
      'Malformed meeting minutes item.',
    );
    expect(minutes.createVersion).not.toHaveBeenCalled();
  });

  it('rejects an inactive member or outsider before reading Minutes', async () => {
    const { minutes, meetings, groups } = dependencies();
    groups.getMembership.mockResolvedValue(undefined);
    await expect(
      new MinutesService(minutes, meetings, groups).getLatest('outsider', meeting.id),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
      statusCode: 403,
    });
    expect(minutes.getLatest).not.toHaveBeenCalled();
  });

  it('allows an active Group Admin to create version 1 with actor and meeting from persisted data', async () => {
    const { minutes, meetings, groups } = dependencies();
    await new MinutesService(minutes, meetings, groups).update('admin-1', meeting.id, input);
    expect(minutes.createVersion).toHaveBeenCalledWith(meeting, 'admin-1', input, 1, undefined);
  });

  it('rejects a regular member from writing', async () => {
    const { minutes, meetings, groups } = dependencies();
    await expect(
      new MinutesService(minutes, meetings, groups).update('user-1', meeting.id, input),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
      statusCode: 403,
    });
    expect(minutes.createVersion).not.toHaveBeenCalled();
  });

  it('rejects writes to a cancelled meeting but still allows reads', async () => {
    const { minutes, meetings, groups } = dependencies();
    meetings.getById.mockResolvedValue({ ...meeting, status: MeetingStatus.CANCELLED });
    minutes.getLatest.mockResolvedValue(saved);
    const service = new MinutesService(minutes, meetings, groups);
    await expect(service.update('admin-1', meeting.id, input)).rejects.toMatchObject({
      code: 'UNPROCESSABLE_ENTITY',
      statusCode: 422,
    });
    await expect(service.getLatest('admin-1', meeting.id)).resolves.toEqual(saved);
  });

  it('accepts active assignees and rejects an unknown assignee', async () => {
    const { minutes, meetings, groups } = dependencies();
    const service = new MinutesService(minutes, meetings, groups);
    await expect(service.update('admin-1', meeting.id, input)).resolves.toEqual(saved);
    expect(groups.getMembership).toHaveBeenCalledWith('group-1', 'user-1');
    groups.getMembership.mockImplementation((_groupId: string, userId: string) =>
      Promise.resolve(userId === 'admin-1' ? { role: GroupRole.GROUP_ADMIN } : undefined),
    );
    await expect(service.update('admin-1', meeting.id, input)).rejects.toMatchObject({
      code: 'UNPROCESSABLE_ENTITY',
      statusCode: 422,
    });
    expect(minutes.createVersion).toHaveBeenCalledTimes(1);
  });

  it.each(['inactive', 'cross-group'])('rejects an %s assignee', async () => {
    const { minutes, meetings, groups } = dependencies();
    groups.getMembership.mockImplementation((groupId: string, userId: string) => {
      if (userId === 'admin-1') {
        return Promise.resolve({ userId, groupId, role: GroupRole.GROUP_ADMIN, active: true });
      }
      return Promise.resolve(undefined);
    });
    await expect(
      new MinutesService(minutes, meetings, groups).update('admin-1', meeting.id, input),
    ).rejects.toMatchObject({ code: 'UNPROCESSABLE_ENTITY', statusCode: 422 });
    expect(minutes.createVersion).not.toHaveBeenCalled();
  });

  it('creates N+1 only when expectedVersion matches and preserves the logical Minutes id', async () => {
    const { minutes, meetings, groups } = dependencies();
    minutes.getLatest.mockResolvedValue({ ...saved, version: 7 });
    const nextInput = { ...input, expectedVersion: 7 };
    await new MinutesService(minutes, meetings, groups).update('admin-1', meeting.id, nextInput);
    expect(minutes.createVersion).toHaveBeenCalledWith(meeting, 'admin-1', nextInput, 8, saved.id);

    await expect(
      new MinutesService(minutes, meetings, groups).update('admin-1', meeting.id, {
        ...input,
        expectedVersion: 6,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT', statusCode: 409 });
  });

  it('rejects a next version above 999999 without writing', async () => {
    const { minutes, meetings, groups } = dependencies();
    minutes.getLatest.mockResolvedValue({ ...saved, version: 999999 });
    await expect(
      new MinutesService(minutes, meetings, groups).update('admin-1', meeting.id, {
        ...input,
        expectedVersion: 999999,
      }),
    ).rejects.toMatchObject({ code: 'UNPROCESSABLE_ENTITY', statusCode: 422 });
    expect(minutes.createVersion).not.toHaveBeenCalled();
  });
});
