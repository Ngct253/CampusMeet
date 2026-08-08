import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GroupRole,
  Priority,
  TaskStatus,
  type CreateTaskRequest,
  type Task,
} from '@campusmeet/shared';

const requireGroupMembership = vi.hoisted(() => vi.fn());
vi.mock('../src/middleware/authorization', () => ({ requireGroupMembership }));

import { TaskService } from '../src/services/task-service';

const input: CreateTaskRequest = {
  groupId: 'group-1',
  title: 'Task',
  assigneeId: 'user-2',
  priority: Priority.HIGH,
};
const task = {
  id: 'task-1',
  ...input,
  status: 'TODO',
  createdBy: 'admin-1',
  createdAt: '2026-08-03T00:00:00.000Z',
  updatedAt: '2026-08-03T00:00:00.000Z',
  version: 1,
} as Task;

const dependencies = () => {
  const tasks = {
    listByAssignee: vi.fn(),
    getById: vi.fn().mockResolvedValue(task),
    create: vi.fn().mockResolvedValue(task),
    updateStatus: vi.fn(),
  };
  const groups = {
    getMembership: vi.fn().mockResolvedValue({ active: true, role: GroupRole.MEMBER }),
  };
  const meetings = { resolveMeetingGroup: vi.fn() };
  return { tasks, groups, meetings };
};

describe('TaskService.createTask', () => {
  beforeEach(() => requireGroupMembership.mockReset().mockResolvedValue({ active: true }));

  it('requires the actor to be an active Group Admin', async () => {
    const { tasks, groups, meetings } = dependencies();
    await new TaskService(tasks, groups, meetings).createTask('admin-1', input, 'key-1');
    expect(requireGroupMembership).toHaveBeenCalledWith(
      'admin-1',
      'group-1',
      GroupRole.GROUP_ADMIN,
    );
  });

  it('rejects an inactive or cross-group assignee', async () => {
    const { tasks, groups, meetings } = dependencies();
    groups.getMembership.mockResolvedValue(undefined);
    await expect(
      new TaskService(tasks, groups, meetings).createTask('admin-1', input, 'key-1'),
    ).rejects.toMatchObject({ code: 'UNPROCESSABLE_ENTITY', statusCode: 422 });
    expect(tasks.create).not.toHaveBeenCalled();
  });

  it('does not query meetings when sourceMeetingId is absent', async () => {
    const { tasks, groups, meetings } = dependencies();
    await new TaskService(tasks, groups, meetings).createTask('admin-1', input, 'key-1');
    expect(meetings.resolveMeetingGroup).not.toHaveBeenCalled();
  });

  it('resolves sourceMeetingId through the public M2 boundary and accepts the same group', async () => {
    const { tasks, groups, meetings } = dependencies();
    meetings.resolveMeetingGroup.mockResolvedValue('group-1');
    const withMeeting = { ...input, sourceMeetingId: 'meeting-1' };
    await new TaskService(tasks, groups, meetings).createTask('admin-1', withMeeting, 'key-1');
    expect(meetings.resolveMeetingGroup).toHaveBeenCalledWith('meeting-1');
    expect(tasks.create).toHaveBeenCalledWith('admin-1', withMeeting, 'key-1');
  });

  it.each([
    ['missing', null],
    ['different group', 'group-2'],
  ])('returns the same 404 for a %s source meeting', async (_label, meetingGroupId) => {
    const { tasks, groups, meetings } = dependencies();
    meetings.resolveMeetingGroup.mockResolvedValue(meetingGroupId);
    await expect(
      new TaskService(tasks, groups, meetings).createTask(
        'admin-1',
        { ...input, sourceMeetingId: 'meeting-1' },
        'key-1',
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', statusCode: 404 });
    expect(tasks.create).not.toHaveBeenCalled();
  });
});

describe('TaskService.updateTaskStatus', () => {
  const taskFor = (status: TaskStatus, version: number | undefined = 1): Task => ({
    ...task,
    status,
    ...(version === undefined ? { version: undefined } : { version }),
  });

  it('returns 404 when the task does not exist', async () => {
    const { tasks, groups, meetings } = dependencies();
    tasks.getById.mockResolvedValue(undefined);

    await expect(
      new TaskService(tasks, groups, meetings).updateTaskStatus('user-2', 'missing', {
        status: TaskStatus.DOING,
        expectedVersion: 1,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', statusCode: 404 });
    expect(groups.getMembership).not.toHaveBeenCalled();
  });

  it.each([
    ['assignee', 'user-2', GroupRole.MEMBER],
    ['Group Admin', 'admin-2', GroupRole.GROUP_ADMIN],
  ])('allows the active %s to update', async (_label, actorId, role) => {
    const { tasks, groups, meetings } = dependencies();
    const current = taskFor(TaskStatus.TODO);
    const updated = { ...current, status: TaskStatus.DOING, version: 2 };
    tasks.getById.mockResolvedValue(current);
    tasks.updateStatus.mockResolvedValue(updated);
    groups.getMembership.mockResolvedValue({ active: true, role });

    await expect(
      new TaskService(tasks, groups, meetings).updateTaskStatus(actorId, current.id, {
        status: TaskStatus.DOING,
        expectedVersion: 1,
      }),
    ).resolves.toEqual(updated);
    expect(tasks.updateStatus).toHaveBeenCalledWith(current, actorId, TaskStatus.DOING, 1, false);
  });

  it.each([
    ['another member', { active: true, role: GroupRole.MEMBER }],
    ['outsider', undefined],
    ['inactive member', undefined],
  ])('returns 403 for %s', async (_label, membership) => {
    const { tasks, groups, meetings } = dependencies();
    groups.getMembership.mockResolvedValue(membership);

    await expect(
      new TaskService(tasks, groups, meetings).updateTaskStatus('other-user', task.id, {
        status: TaskStatus.DOING,
        expectedVersion: 1,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', statusCode: 403 });
    expect(tasks.updateStatus).not.toHaveBeenCalled();
  });

  it.each([
    [TaskStatus.TODO, TaskStatus.DOING],
    [TaskStatus.DOING, TaskStatus.DONE],
    [TaskStatus.DONE, TaskStatus.DOING],
  ])('allows transition %s -> %s', async (fromStatus, toStatus) => {
    const { tasks, groups, meetings } = dependencies();
    const current = taskFor(fromStatus);
    tasks.getById.mockResolvedValue(current);
    tasks.updateStatus.mockResolvedValue({ ...current, status: toStatus, version: 2 });

    await new TaskService(tasks, groups, meetings).updateTaskStatus('user-2', current.id, {
      status: toStatus,
      expectedVersion: 1,
      ...(toStatus === TaskStatus.DONE ? { completionNote: 'Đã bàn giao bản demo.' } : {}),
    });
    expect(tasks.updateStatus).toHaveBeenCalledWith(
      current,
      'user-2',
      toStatus,
      1,
      false,
      ...(toStatus === TaskStatus.DONE ? ['Đã bàn giao bản demo.', undefined] : []),
    );
  });

  it.each([
    [TaskStatus.TODO, TaskStatus.DONE],
    [TaskStatus.DOING, TaskStatus.TODO],
    [TaskStatus.DONE, TaskStatus.TODO],
  ])('returns 422 for unsupported %s -> %s', async (fromStatus, toStatus) => {
    const { tasks, groups, meetings } = dependencies();
    tasks.getById.mockResolvedValue(taskFor(fromStatus));

    await expect(
      new TaskService(tasks, groups, meetings).updateTaskStatus('user-2', task.id, {
        status: toStatus,
        expectedVersion: 1,
      }),
    ).rejects.toMatchObject({ code: 'UNPROCESSABLE_ENTITY', statusCode: 422 });
    expect(tasks.updateStatus).not.toHaveBeenCalled();
  });

  it('requires a result before completing DOING -> DONE', async () => {
    const { tasks, groups, meetings } = dependencies();
    tasks.getById.mockResolvedValue(taskFor(TaskStatus.DOING));

    await expect(
      new TaskService(tasks, groups, meetings).updateTaskStatus('user-2', task.id, {
        status: TaskStatus.DONE,
        expectedVersion: 1,
      }),
    ).rejects.toMatchObject({ code: 'UNPROCESSABLE_ENTITY', statusCode: 422 });
    expect(tasks.updateStatus).not.toHaveBeenCalled();
  });

  it('returns the current task for same-status without writing', async () => {
    const { tasks, groups, meetings } = dependencies();
    const current = taskFor(TaskStatus.DOING);
    tasks.getById.mockResolvedValue(current);

    await expect(
      new TaskService(tasks, groups, meetings).updateTaskStatus('user-2', task.id, {
        status: TaskStatus.DOING,
        expectedVersion: 1,
      }),
    ).resolves.toEqual(current);
    expect(tasks.updateStatus).not.toHaveBeenCalled();
  });

  it('checks expectedVersion before treating same-status as a no-op', async () => {
    const { tasks, groups, meetings } = dependencies();
    tasks.getById.mockResolvedValue(taskFor(TaskStatus.DOING, 2));

    await expect(
      new TaskService(tasks, groups, meetings).updateTaskStatus('user-2', task.id, {
        status: TaskStatus.DOING,
        expectedVersion: 1,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT', statusCode: 409 });
    expect(tasks.updateStatus).not.toHaveBeenCalled();
  });

  it('treats a legacy task without version as version 0', async () => {
    const { tasks, groups, meetings } = dependencies();
    const legacy: Task = { ...task, status: TaskStatus.TODO };
    delete legacy.version;
    tasks.getById.mockResolvedValue(legacy);
    tasks.updateStatus.mockResolvedValue({ ...legacy, status: TaskStatus.DOING, version: 1 });

    await new TaskService(tasks, groups, meetings).updateTaskStatus('user-2', task.id, {
      status: TaskStatus.DOING,
      expectedVersion: 0,
    });
    expect(tasks.updateStatus).toHaveBeenCalledWith(legacy, 'user-2', TaskStatus.DOING, 0, true);
  });

  it('returns 409 for persisted version 0 without starting a transaction', async () => {
    const { tasks, groups, meetings } = dependencies();
    tasks.getById.mockResolvedValue(taskFor(TaskStatus.TODO, 0));

    await expect(
      new TaskService(tasks, groups, meetings).updateTaskStatus('user-2', task.id, {
        status: TaskStatus.DOING,
        expectedVersion: 0,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT', statusCode: 409 });
    expect(tasks.updateStatus).not.toHaveBeenCalled();
  });

  it('does not treat same-status persisted version 0 as a successful no-op', async () => {
    const { tasks, groups, meetings } = dependencies();
    tasks.getById.mockResolvedValue(taskFor(TaskStatus.DOING, 0));

    await expect(
      new TaskService(tasks, groups, meetings).updateTaskStatus('user-2', task.id, {
        status: TaskStatus.DOING,
        expectedVersion: 0,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT', statusCode: 409 });
    expect(tasks.updateStatus).not.toHaveBeenCalled();
  });
});
