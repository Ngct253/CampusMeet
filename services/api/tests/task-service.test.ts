import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GroupRole, Priority, type CreateTaskRequest, type Task } from '@campusmeet/shared';

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
    create: vi.fn().mockResolvedValue(task),
  };
  const groups = { getMembership: vi.fn().mockResolvedValue({ active: true }) };
  const meetings = { getById: vi.fn() };
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
    expect(meetings.getById).not.toHaveBeenCalled();
  });

  it('accepts a source meeting in the same group', async () => {
    const { tasks, groups, meetings } = dependencies();
    meetings.getById.mockResolvedValue({ id: 'meeting-1', groupId: 'group-1' });
    const withMeeting = { ...input, sourceMeetingId: 'meeting-1' };
    await new TaskService(tasks, groups, meetings).createTask('admin-1', withMeeting, 'key-1');
    expect(tasks.create).toHaveBeenCalledWith('admin-1', withMeeting, 'key-1');
  });

  it.each([
    ['missing', undefined],
    ['different group', { id: 'meeting-1', groupId: 'group-2' }],
  ])('returns the same 404 for a %s source meeting', async (_label, meeting) => {
    const { tasks, groups, meetings } = dependencies();
    meetings.getById.mockResolvedValue(meeting);
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
