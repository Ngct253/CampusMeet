import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GoogleSyncStatus,
  GroupRole,
  IntegrationStatus,
  MeetingStatus,
  Priority,
  TaskStatus,
  type Meeting,
  type MeetingMinutes,
  type Task,
} from '@campusmeet/shared';
import { ActionItemTaskService } from '../src/services/action-item-task-service';

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

const minutes: MeetingMinutes = {
  id: 'minutes-1',
  meetingId: meeting.id,
  groupId: meeting.groupId,
  summary: 'Tóm tắt',
  discussion: '',
  decisions: [{ id: 'decision-1', content: 'Quyết định' }],
  actionItems: [
    {
      id: 'action-1',
      content: 'Hoàn thiện báo cáo',
      assigneeId: 'user-1',
      dueAt: '2026-08-10T03:30:00.000Z',
    },
  ],
  version: 2,
  createdBy: 'admin-1',
  createdAt: '2026-08-04T03:00:00.000Z',
};

const linkedTask: Task = {
  id: 'task-linked',
  groupId: meeting.groupId,
  title: 'Hoàn thiện báo cáo',
  assigneeId: 'user-1',
  status: TaskStatus.TODO,
  priority: Priority.HIGH,
  sourceMeetingId: meeting.id,
  sourceActionItemId: 'action-1',
  version: 1,
};

const request = {
  expectedMinutesVersion: 2,
  priority: Priority.HIGH,
};

const dependencies = () => {
  const meetings = { getById: vi.fn().mockResolvedValue(meeting) };
  const minutesRepository = { getLatest: vi.fn().mockResolvedValue(minutes) };
  const groups = {
    getMembership: vi.fn().mockImplementation((groupId: string, userId: string) => {
      if (groupId !== 'group-1') return Promise.resolve(undefined);
      if (userId === 'admin-1') {
        return Promise.resolve({ groupId, userId, role: GroupRole.GROUP_ADMIN, active: true });
      }
      if (userId === 'user-1') {
        return Promise.resolve({ groupId, userId, role: GroupRole.MEMBER, active: true });
      }
      if (userId === 'inactive-1') {
        return Promise.resolve({ groupId, userId, role: GroupRole.MEMBER, active: false });
      }
      return Promise.resolve(undefined);
    }),
  };
  const conversions = {
    getTaskById: vi.fn().mockResolvedValue(undefined),
    create: vi.fn().mockImplementation(async (input) => ({
      task: {
        id: 'task-new',
        groupId: input.meeting.groupId,
        title: input.title,
        assigneeId: input.assigneeId,
        priority: input.priority,
        status: TaskStatus.TODO,
        dueAt: minutes.actionItems[0]?.dueAt,
        sourceMeetingId: input.meeting.id,
        sourceActionItemId: input.actionItemId,
        createdBy: input.actorId,
        version: 1,
      },
      minutes: { ...input.minutes, version: input.minutes.version + 1 },
    })),
  };
  return { meetings, minutesRepository, groups, conversions };
};

const serviceFor = (deps: ReturnType<typeof dependencies>) =>
  new ActionItemTaskService(
    deps.meetings,
    deps.minutesRepository as never,
    deps.groups,
    deps.conversions,
  );

describe('ActionItemTaskService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 404 for a missing meeting before membership or Minutes lookup', async () => {
    const deps = dependencies();
    deps.meetings.getById.mockResolvedValue(null);
    await expect(
      serviceFor(deps).convert('admin-1', 'missing', 'action-1', request),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', statusCode: 404 });
    expect(deps.groups.getMembership).not.toHaveBeenCalled();
    expect(deps.minutesRepository.getLatest).not.toHaveBeenCalled();
  });

  it.each([
    ['member assignee', 'user-1'],
    ['inactive member', 'inactive-1'],
    ['outsider', 'outsider-1'],
  ])('returns 403 for %s', async (_label, actorId) => {
    const deps = dependencies();
    await expect(
      serviceFor(deps).convert(actorId, meeting.id, 'action-1', request),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', statusCode: 403 });
    expect(deps.minutesRepository.getLatest).not.toHaveBeenCalled();
    expect(deps.conversions.create).not.toHaveBeenCalled();
  });

  it('returns 404 when Minutes or the latest Action Item is missing', async () => {
    const deps = dependencies();
    deps.minutesRepository.getLatest.mockResolvedValueOnce(null);
    await expect(
      serviceFor(deps).convert('admin-1', meeting.id, 'action-1', request),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', statusCode: 404 });

    deps.minutesRepository.getLatest.mockResolvedValueOnce({ ...minutes, actionItems: [] });
    await expect(
      serviceFor(deps).convert('admin-1', meeting.id, 'deleted-action', request),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', statusCode: 404 });
    expect(deps.conversions.create).not.toHaveBeenCalled();
  });

  it('rejects Minutes that do not belong to the persisted meeting', async () => {
    const deps = dependencies();
    deps.minutesRepository.getLatest.mockResolvedValue({ ...minutes, groupId: 'group-other' });
    await expect(
      serviceFor(deps).convert('admin-1', meeting.id, 'action-1', request),
    ).rejects.toThrow('Malformed meeting minutes item.');
    expect(deps.conversions.create).not.toHaveBeenCalled();
  });

  it('returns 422 for a cancelled meeting', async () => {
    const deps = dependencies();
    deps.meetings.getById.mockResolvedValue({ ...meeting, status: MeetingStatus.CANCELLED });
    await expect(
      serviceFor(deps).convert('admin-1', meeting.id, 'action-1', request),
    ).rejects.toMatchObject({ code: 'UNPROCESSABLE_ENTITY', statusCode: 422 });
    expect(deps.minutesRepository.getLatest).not.toHaveBeenCalled();
  });

  it('maps persisted source data and the JWT actor for an active Group Admin', async () => {
    const deps = dependencies();
    const response = await serviceFor(deps).convert('admin-1', meeting.id, 'action-1', request);
    expect(response.task).toMatchObject({
      createdBy: 'admin-1',
      dueAt: minutes.actionItems[0]?.dueAt,
    });
    expect(deps.conversions.create).toHaveBeenCalledWith({
      actorId: 'admin-1',
      meeting,
      minutes,
      actionItemId: 'action-1',
      title: 'Hoàn thiện báo cáo',
      assigneeId: 'user-1',
      priority: Priority.HIGH,
    });
    expect(deps.groups.getMembership).toHaveBeenCalledWith('group-1', 'user-1');
  });

  it('requires the request assignee only when the persisted Action Item has none', async () => {
    const deps = dependencies();
    deps.minutesRepository.getLatest.mockResolvedValue({
      ...minutes,
      actionItems: [{ id: 'action-1', content: 'Task' }],
    });
    await expect(
      serviceFor(deps).convert('admin-1', meeting.id, 'action-1', request),
    ).rejects.toMatchObject({ code: 'UNPROCESSABLE_ENTITY', statusCode: 422 });

    await serviceFor(deps).convert('admin-1', meeting.id, 'action-1', {
      ...request,
      assigneeId: 'user-1',
    });
    expect(deps.conversions.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ assigneeId: 'user-1' }),
    );
  });

  it('rejects override, inactive, unknown, or cross-group assignees', async () => {
    const deps = dependencies();
    const service = serviceFor(deps);
    await expect(
      service.convert('admin-1', meeting.id, 'action-1', { ...request, assigneeId: 'user-1' }),
    ).rejects.toMatchObject({ code: 'UNPROCESSABLE_ENTITY', statusCode: 422 });

    deps.minutesRepository.getLatest.mockResolvedValue({
      ...minutes,
      actionItems: [{ id: 'action-1', content: 'Task' }],
    });
    for (const assigneeId of ['inactive-1', 'unknown-1', 'cross-group-user']) {
      await expect(
        service.convert('admin-1', meeting.id, 'action-1', {
          ...request,
          assigneeId,
        }),
      ).rejects.toMatchObject({ code: 'UNPROCESSABLE_ENTITY', statusCode: 422 });
    }
    expect(deps.conversions.create).not.toHaveBeenCalled();
  });

  it('requires a title override for source content above 200 characters without truncating', async () => {
    const deps = dependencies();
    deps.minutesRepository.getLatest.mockResolvedValue({
      ...minutes,
      actionItems: [{ ...minutes.actionItems[0]!, content: 'x'.repeat(201) }],
    });
    await expect(
      serviceFor(deps).convert('admin-1', meeting.id, 'action-1', request),
    ).rejects.toMatchObject({ code: 'UNPROCESSABLE_ENTITY', statusCode: 422 });

    await serviceFor(deps).convert('admin-1', meeting.id, 'action-1', {
      ...request,
      title: 'Tiêu đề xác nhận',
    });
    expect(deps.conversions.create).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Tiêu đề xác nhận' }),
    );
  });

  it('returns 409 for a stale version and 422 at the maximum version', async () => {
    const deps = dependencies();
    await expect(
      serviceFor(deps).convert('admin-1', meeting.id, 'action-1', {
        ...request,
        expectedMinutesVersion: 1,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT', statusCode: 409 });

    deps.minutesRepository.getLatest.mockResolvedValue({ ...minutes, version: 999999 });
    await expect(
      serviceFor(deps).convert('admin-1', meeting.id, 'action-1', {
        ...request,
        expectedMinutesVersion: 999999,
      }),
    ).rejects.toMatchObject({ code: 'UNPROCESSABLE_ENTITY', statusCode: 422 });
    expect(deps.conversions.create).not.toHaveBeenCalled();
  });

  it('replays an existing valid task link before checking stale expectedVersion', async () => {
    const deps = dependencies();
    const linkedMinutes = {
      ...minutes,
      actionItems: [{ ...minutes.actionItems[0]!, taskId: linkedTask.id }],
      version: 3,
    };
    deps.minutesRepository.getLatest.mockResolvedValue(linkedMinutes);
    deps.conversions.getTaskById.mockResolvedValue(linkedTask);

    await expect(
      serviceFor(deps).convert('admin-1', meeting.id, 'action-1', {
        ...request,
        expectedMinutesVersion: 2,
      }),
    ).resolves.toEqual({ task: linkedTask, minutes: linkedMinutes });
    expect(deps.conversions.create).not.toHaveBeenCalled();
  });

  it.each([
    ['missing task', undefined],
    ['wrong meeting provenance', { ...linkedTask, sourceMeetingId: 'meeting-other' }],
    ['wrong action provenance', { ...linkedTask, sourceActionItemId: 'action-other' }],
  ])('rejects a broken linked task: %s', async (_label, task) => {
    const deps = dependencies();
    deps.minutesRepository.getLatest.mockResolvedValue({
      ...minutes,
      actionItems: [{ ...minutes.actionItems[0]!, taskId: linkedTask.id }],
    });
    deps.conversions.getTaskById.mockResolvedValue(task);
    await expect(
      serviceFor(deps).convert('admin-1', meeting.id, 'action-1', request),
    ).rejects.toThrow('Malformed Action Item task link.');
    expect(deps.conversions.create).not.toHaveBeenCalled();
  });
});
