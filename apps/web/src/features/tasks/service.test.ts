import { beforeEach, describe, expect, it, vi } from 'vitest';

const request = vi.hoisted(() => vi.fn());
vi.mock('../../lib/api-client', () => ({ apiClient: { request } }));

import { getTasks } from './service';

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
});
