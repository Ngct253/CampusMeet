import { beforeEach, describe, expect, it, vi } from 'vitest';

const request = vi.hoisted(() => vi.fn());
vi.mock('../../lib/api-client', () => ({ apiClient: { request } }));

import { connectGoogleCalendar } from './service';

describe('settings integration service', () => {
  beforeEach(() => request.mockReset());

  it('starts Google OAuth through the authenticated backend endpoint', async () => {
    const target = {
      authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth?state=state',
      expiresAt: '2026-08-06T12:00:00.000Z',
    };
    request.mockResolvedValue({ success: true, data: target, requestId: 'request-1' });

    await expect(connectGoogleCalendar()).resolves.toEqual(target);
    expect(request).toHaveBeenCalledWith('/integrations/google/connect', { method: 'POST' });
  });
});
