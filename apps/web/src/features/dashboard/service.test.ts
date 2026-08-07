import { beforeEach, describe, expect, it, vi } from 'vitest';

const request = vi.hoisted(() => vi.fn());
vi.mock('../../lib/api-client', () => ({ apiClient: { request } }));

import { getDashboard } from './service';

describe('dashboard service', () => {
  beforeEach(() => request.mockReset());

  it('loads and unwraps the personal task summary from GET /dashboard', async () => {
    const dashboard = {
      generatedAt: '2026-08-05T10:00:00.000Z',
      tasks: { total: 5, todo: 2, doing: 1, done: 2, overdue: 1 },
    };
    request.mockResolvedValue({ success: true, data: dashboard, requestId: 'request-1' });

    await expect(getDashboard()).resolves.toEqual(dashboard);
    expect(request).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledWith('/dashboard');
  });
});
