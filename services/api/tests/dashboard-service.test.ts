import { describe, expect, it, vi } from 'vitest';
import { Priority, TaskStatus, type Task } from '@campusmeet/shared';
import { DashboardService } from '../src/services/dashboard-service';

const generatedAt = new Date('2026-08-05T10:00:00.000Z');
const task = (status: TaskStatus, dueAt?: string): Task => ({
  id: `${status}-${dueAt ?? 'no-due'}`,
  groupId: 'group-1',
  title: 'Task',
  assigneeId: 'user-1',
  status,
  priority: Priority.MEDIUM,
  ...(dueAt ? { dueAt } : {}),
});

describe('DashboardService', () => {
  it('returns deterministic zero counts for an empty task list', async () => {
    const listByAssignee = vi.fn().mockResolvedValue([]);
    const clock = vi.fn(() => generatedAt);

    await expect(
      new DashboardService({ listByAssignee }, clock).getPersonalTaskSummary('user-1'),
    ).resolves.toEqual({
      generatedAt: '2026-08-05T10:00:00.000Z',
      tasks: { total: 0, todo: 0, doing: 0, done: 0, overdue: 0 },
    });
    expect(listByAssignee).toHaveBeenCalledOnce();
    expect(listByAssignee).toHaveBeenCalledWith('user-1');
    expect(clock).toHaveBeenCalledOnce();
  });

  it('counts each status and only overdue unfinished tasks', async () => {
    const listByAssignee = vi.fn().mockResolvedValue([
      task(TaskStatus.TODO, '2026-08-05T09:59:59.999Z'),
      task(TaskStatus.TODO),
      task(TaskStatus.DOING, '2026-08-04T10:00:00.000Z'),
      task(TaskStatus.DOING, '2026-08-05T10:00:00.000Z'),
      task(TaskStatus.DONE, '2026-08-01T10:00:00.000Z'),
    ]);

    const result = await new DashboardService({ listByAssignee }, () => generatedAt)
      .getPersonalTaskSummary('user-1');

    expect(result.tasks).toEqual({ total: 5, todo: 2, doing: 2, done: 1, overdue: 2 });
    expect(result.tasks.total).toBe(
      result.tasks.todo + result.tasks.doing + result.tasks.done,
    );
    expect(listByAssignee).toHaveBeenCalledOnce();
  });

  it.each([
    ['DONE quá hạn', task(TaskStatus.DONE, '2026-08-05T09:59:59.999Z')],
    ['không có dueAt', task(TaskStatus.TODO)],
    ['dueAt bằng generatedAt', task(TaskStatus.DOING, '2026-08-05T10:00:00.000Z')],
  ])('does not count %s as overdue', async (_case, assignedTask) => {
    const result = await new DashboardService(
      { listByAssignee: vi.fn().mockResolvedValue([assignedTask]) },
      () => generatedAt,
    ).getPersonalTaskSummary('user-1');

    expect(result.tasks.overdue).toBe(0);
  });
});
