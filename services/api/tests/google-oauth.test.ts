import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GoogleOAuthService } from '../src/integrations/google-oauth';

const credentials = {
  get: vi.fn(async () => ({ clientId: 'client-id', clientSecret: 'client-secret' })),
};

describe('GoogleOAuthService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GOOGLE_REDIRECT_URI =
      'https://api.example.com/integrations/google/callback';
  });

  it('creates a short-lived state and an offline-consent URL', async () => {
    const store = {
      createState: vi.fn(async () => undefined),
      consumeState: vi.fn(),
      saveTokens: vi.fn(),
    };
    const service = new GoogleOAuthService(
      store,
      credentials,
      vi.fn(),
      () => new Date('2026-08-06T00:00:00.000Z'),
    );

    const result = await service.createAuthorizationUrl('user-1');
    const url = new URL(result.authorizationUrl);

    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('client_id')).toBe('client-id');
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toBe('consent');
    expect(url.searchParams.get('scope')).toContain('calendar.events');
    expect(store.createState).toHaveBeenCalledWith(
      expect.stringMatching(/^[a-f0-9]{64}$/),
      'user-1',
      1785975000,
    );
  });

  it('consumes state, exchanges the code and stores tokens without exposing the secret', async () => {
    const store = {
      createState: vi.fn(),
      consumeState: vi.fn(async () => 'user-1'),
      saveTokens: vi.fn(async () => undefined),
    };
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      access_token: 'access-token',
      refresh_token: 'refresh-token',
      expires_in: 3600,
      scope: 'openid calendar',
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const service = new GoogleOAuthService(
      store,
      credentials,
      fetcher,
      () => new Date('2026-08-06T00:00:00.000Z'),
    );

    await expect(service.complete('authorization-code', 'state-value')).resolves.toBe('user-1');
    expect(fetcher).toHaveBeenCalledWith(
      'https://oauth2.googleapis.com/token',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(store.saveTokens).toHaveBeenCalledWith('user-1', {
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresAt: '2026-08-06T01:00:00.000Z',
      scope: 'openid calendar',
    });
  });

  it('rejects an expired or replayed state before token exchange', async () => {
    const store = {
      createState: vi.fn(),
      consumeState: vi.fn(async () => undefined),
      saveTokens: vi.fn(),
    };
    const fetcher = vi.fn();
    const service = new GoogleOAuthService(store, credentials, fetcher);

    await expect(service.complete('code', 'invalid-state')).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
