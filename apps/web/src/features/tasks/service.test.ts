import { beforeEach, describe, expect, it, vi } from 'vitest';

const request = vi.hoisted(() => vi.fn());
vi.mock('../../lib/api-client', () => ({ apiClient: { request } }));

import { Priority, TaskStatus, type CreateTaskRequest } from '@campusmeet/shared';
import { createTask, getTasks, updateTaskStatus } from './service';

describe('task service', () => {
  beforeEach(() => request.mockReset());

  it('loads the authenticated user task list from GET /tasks', async () => {
    const tasks = [
      {
        id: 'task-1',
        groupId: 'group-1',
        title: 'Hoàn thiện báo cáo',
        assigneeId: 'user-1',
        status: 'TODO',
        priority: 'HIGH',
      },
    ];
    request.mockResolvedValue({ success: true, data: tasks, requestId: 'request-1' });

    await expect(getTasks()).resolves.toEqual(tasks);
    expect(request).toHaveBeenCalledWith('/tasks');
  });

  it('creates a task with the shared request and Idempotency-Key', async () => {
    const input: CreateTaskRequest = {
      groupId: 'group-1',
      title: 'Hoàn thiện báo cáo',
      assigneeId: 'user-2',
      priority: Priority.MEDIUM,
    };
    const task = {
      id: 'task-1',
      ...input,
      status: 'TODO',
      createdBy: 'admin-1',
      createdAt: '2026-08-03T00:00:00.000Z',
      updatedAt: '2026-08-03T00:00:00.000Z',
      version: 1,
    };
    request.mockResolvedValue({ success: true, data: task, requestId: 'request-1' });

    await expect(createTask(input, 'task-key')).resolves.toEqual(task);
    expect(request).toHaveBeenCalledWith('/tasks', {
      method: 'POST',
      headers: { 'idempotency-key': 'task-key' },
      body: JSON.stringify(input),
    });
    const sentBody = JSON.parse(request.mock.calls[0]?.[1]?.body as string) as Record<
      string,
      unknown
    >;
    expect(sentBody).not.toHaveProperty('createdBy');
    expect(sentBody).not.toHaveProperty('role');
    expect(sentBody).not.toHaveProperty('status');
    expect(sentBody).not.toHaveProperty('version');
    expect(sentBody).not.toHaveProperty('createdAt');
    expect(sentBody).not.toHaveProperty('updatedAt');
  });

  it('updates task status with the shared expectedVersion request', async () => {
    const updated = {
      id: 'task/1',
      groupId: 'group-1',
      title: 'Hoàn thiện báo cáo',
      assigneeId: 'user-1',
      priority: Priority.HIGH,
      status: TaskStatus.DONE,
      version: 2,
    };
    request.mockResolvedValue({ success: true, data: updated, requestId: 'request-1' });

    await expect(
      updateTaskStatus('task/1', { status: TaskStatus.DONE, expectedVersion: 1 }),
    ).resolves.toEqual(updated);
    expect(request).toHaveBeenCalledWith('/tasks/task%2F1/status', {
      method: 'PATCH',
      body: JSON.stringify({ status: TaskStatus.DONE, expectedVersion: 1 }),
    });
  });
});
