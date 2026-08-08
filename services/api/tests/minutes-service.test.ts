import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GoogleSyncStatus,
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
  agenda: [],
  startsAt: '2026-08-04T01:00:00.000Z',
  endsAt: '2026-08-04T02:00:00.000Z',
  status: MeetingStatus.COMPLETED,
  googleSyncStatus: GoogleSyncStatus.NOT_REQUESTED,
  integrationStatus: IntegrationStatus.READY,
  createdAt: '2026-08-04T00:00:00.000Z',
  createdBy: 'admin-1',
  updatedAt: '2026-08-04T00:00:00.000Z',
  updatedBy: 'admin-1',
  version: 1,
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
  actionItems: [
    {
      id: 'action-1',
      content: 'Hành động',
      assigneeId: 'user-1',
      dueAt: '2026-08-10T03:30:00.000Z',
      taskId: 'task-1',
    },
  ],
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
    expect(minutes.createVersion).toHaveBeenCalledWith(
      meeting,
      'admin-1',
      expect.objectContaining({
        ...input,
        decisions: [
          expect.objectContaining({
            id: expect.any(String),
            content: 'Quyết định',
          }),
        ],
        actionItems: [
          expect.objectContaining({
            id: expect.any(String),
            content: 'Hành động',
            assigneeId: 'user-1',
          }),
        ],
      }),
      1,
      undefined,
    );
  });

  it('assigns distinct server ids to every new Decision on first creation', async () => {
    const { minutes, meetings, groups } = dependencies();
    await new MinutesService(minutes, meetings, groups).update('admin-1', meeting.id, {
      ...input,
      decisions: [{ content: 'Nội dung giống nhau' }, { content: 'Nội dung giống nhau' }],
    });

    const decisions = minutes.createVersion.mock.calls[0]?.[2].decisions;
    expect(decisions).toEqual([
      { id: expect.any(String), content: 'Nội dung giống nhau' },
      { id: expect.any(String), content: 'Nội dung giống nhau' },
    ]);
    expect(decisions[0]?.id).not.toBe(decisions[1]?.id);
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
    const nextInput: UpdateMeetingMinutesRequest = {
      ...input,
      decisions: [{ id: 'decision-1', content: 'Quyết định cập nhật' }],
      actionItems: [
        {
          id: 'action-1',
          content: 'Hành động cập nhật',
          assigneeId: 'user-1',
          dueAt: '2026-08-11T03:30:00.000Z',
        },
      ],
      expectedVersion: 7,
    };
    await new MinutesService(minutes, meetings, groups).update('admin-1', meeting.id, nextInput);
    expect(minutes.createVersion).toHaveBeenCalledWith(
      meeting,
      'admin-1',
      {
        ...nextInput,
        decisions: [{ id: 'decision-1', content: 'Quyết định cập nhật' }],
        actionItems: [
          {
            id: 'action-1',
            content: 'Hành động cập nhật',
            assigneeId: 'user-1',
            dueAt: '2026-08-11T03:30:00.000Z',
            taskId: 'task-1',
          },
        ],
      },
      8,
      saved.id,
    );

    await expect(
      new MinutesService(minutes, meetings, groups).update('admin-1', meeting.id, {
        ...input,
        expectedVersion: 6,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT', statusCode: 409 });
    expect(minutes.createVersion).toHaveBeenCalledTimes(1);
  });

  it('preserves Decision identity across edits, reorder and removal while assigning only new ids', async () => {
    const { minutes, meetings, groups } = dependencies();
    minutes.getLatest.mockResolvedValue({
      ...saved,
      decisions: [
        { id: 'decision-1', content: 'Giống nhau' },
        { id: 'decision-2', content: 'Giống nhau' },
        { id: 'decision-removed', content: 'Sẽ xóa' },
      ],
    });

    await new MinutesService(minutes, meetings, groups).update('admin-1', meeting.id, {
      ...input,
      expectedVersion: 1,
      decisions: [
        { id: 'decision-2', content: 'Giống nhau đã sửa' },
        { id: 'decision-1', content: 'Giống nhau' },
        { content: 'Giống nhau' },
      ],
    });

    const resolved = minutes.createVersion.mock.calls[0]?.[2];
    expect(resolved.decisions).toEqual([
      { id: 'decision-2', content: 'Giống nhau đã sửa' },
      { id: 'decision-1', content: 'Giống nhau' },
      { id: expect.any(String), content: 'Giống nhau' },
    ]);
    expect(resolved.decisions[2]?.id).not.toBe('decision-1');
    expect(resolved.decisions[2]?.id).not.toBe('decision-2');
    expect(resolved.decisions).not.toContainEqual(
      expect.objectContaining({ id: 'decision-removed' }),
    );
  });

  it('rejects duplicate and unknown Decision ids without creating a version', async () => {
    const { minutes, meetings, groups } = dependencies();
    minutes.getLatest.mockResolvedValue(saved);
    const service = new MinutesService(minutes, meetings, groups);
    const base = { ...input, expectedVersion: 1, actionItems: [] };

    await expect(
      service.update('admin-1', meeting.id, {
        ...base,
        decisions: [
          { id: 'decision-1', content: 'A' },
          { id: 'decision-1', content: 'B' },
        ],
      }),
    ).rejects.toMatchObject({ code: 'UNPROCESSABLE_ENTITY', statusCode: 422 });
    await expect(
      service.update('admin-1', meeting.id, {
        ...base,
        decisions: [{ id: 'decision-forged', content: 'A' }],
      }),
    ).rejects.toMatchObject({ code: 'UNPROCESSABLE_ENTITY', statusCode: 422 });
    expect(minutes.createVersion).not.toHaveBeenCalled();
  });

  it('keeps stale-version conflict authoritative before Decision reconciliation', async () => {
    const { minutes, meetings, groups } = dependencies();
    minutes.getLatest.mockResolvedValue(saved);

    await expect(
      new MinutesService(minutes, meetings, groups).update('admin-1', meeting.id, {
        ...input,
        expectedVersion: 0,
        decisions: [{ id: 'decision-forged', content: 'Không được reconcile' }],
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT', statusCode: 409 });
    expect(minutes.createVersion).not.toHaveBeenCalled();
  });

  it('rejects duplicate and unknown action item ids without creating a version', async () => {
    const { minutes, meetings, groups } = dependencies();
    minutes.getLatest.mockResolvedValue(saved);
    const service = new MinutesService(minutes, meetings, groups);
    const base = { ...input, expectedVersion: 1 };

    await expect(
      service.update('admin-1', meeting.id, {
        ...base,
        actionItems: [
          { id: 'action-1', content: 'A' },
          { id: 'action-1', content: 'B' },
        ],
      }),
    ).rejects.toMatchObject({ code: 'UNPROCESSABLE_ENTITY', statusCode: 422 });
    await expect(
      service.update('admin-1', meeting.id, {
        ...base,
        actionItems: [{ id: 'action-unknown', content: 'A' }],
      }),
    ).rejects.toMatchObject({ code: 'UNPROCESSABLE_ENTITY', statusCode: 422 });
    expect(minutes.createVersion).not.toHaveBeenCalled();
  });

  it('preserves ids and task links while reordering and deleting action items', async () => {
    const { minutes, meetings, groups } = dependencies();
    minutes.getLatest.mockResolvedValue({
      ...saved,
      actionItems: [
        { id: 'action-1', content: 'Một', taskId: 'task-1' },
        { id: 'action-2', content: 'Hai', taskId: 'task-2' },
        { id: 'action-3', content: 'Ba', dueAt: '2026-08-12T03:30:00.000Z' },
      ],
    });
    await new MinutesService(minutes, meetings, groups).update('admin-1', meeting.id, {
      ...input,
      expectedVersion: 1,
      actionItems: [
        { id: 'action-3', content: 'Ba cập nhật', dueAt: '2026-08-13T03:30:00.000Z' },
        { id: 'action-1', content: 'Một cập nhật' },
      ],
    });

    const resolved = minutes.createVersion.mock.calls[0]?.[2];
    expect(resolved.actionItems).toEqual([
      { id: 'action-3', content: 'Ba cập nhật', dueAt: '2026-08-13T03:30:00.000Z' },
      { id: 'action-1', content: 'Một cập nhật', taskId: 'task-1' },
    ]);
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
