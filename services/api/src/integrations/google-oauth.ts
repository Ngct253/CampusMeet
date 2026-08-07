import { createHash, randomBytes } from 'node:crypto';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import type { GoogleOAuthTokens } from '../repositories/google-integration';
import { BadRequestError, ServiceConfigurationError } from '../utils/errors';

export interface GoogleOAuthClientCredentials {
  clientId: string;
  clientSecret: string;
}

export interface GoogleOAuthStateStore {
  createState(stateHash: string, userId: string, expiresAtEpoch: number): Promise<void>;
  consumeState(stateHash: string, nowEpoch: number): Promise<string | undefined>;
  saveTokens(userId: string, tokens: GoogleOAuthTokens): Promise<void>;
}

export interface GoogleCredentialsProvider {
  get(): Promise<GoogleOAuthClientCredentials>;
}

const requiredEnvironment = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) throw new ServiceConfigurationError(`Thiếu cấu hình ${name}.`);
  return value;
};

export class SecretsManagerGoogleCredentialsProvider implements GoogleCredentialsProvider {
  constructor(private readonly client = new SecretsManagerClient({})) {}

  async get(): Promise<GoogleOAuthClientCredentials> {
    const result = await this.client.send(new GetSecretValueCommand({
      SecretId: requiredEnvironment('GOOGLE_SECRET_REFERENCE'),
    }));
    if (!result.SecretString) throw new ServiceConfigurationError('Google OAuth secret không có SecretString.');
    try {
      const value = JSON.parse(result.SecretString) as Record<string, unknown>;
      if (typeof value.clientId !== 'string' || typeof value.clientSecret !== 'string') throw new Error();
      return { clientId: value.clientId, clientSecret: value.clientSecret };
    } catch {
      throw new ServiceConfigurationError('Google OAuth secret phải chứa clientId và clientSecret.');
    }
  }
}

const stateHash = (state: string) => createHash('sha256').update(state).digest('hex');

export class GoogleOAuthService {
  constructor(
    private readonly store: GoogleOAuthStateStore,
    private readonly credentials: GoogleCredentialsProvider,
    private readonly fetcher: typeof fetch = fetch,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async createAuthorizationUrl(userId: string) {
    const state = randomBytes(32).toString('base64url');
    const expiresAt = Math.floor(this.now().getTime() / 1000) + 10 * 60;
    await this.store.createState(stateHash(state), userId, expiresAt);
    const { clientId } = await this.credentials.get();
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.search = new URLSearchParams({
      client_id: clientId,
      redirect_uri: requiredEnvironment('GOOGLE_REDIRECT_URI'),
      response_type: 'code',
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
      scope: [
        'openid',
        'email',
        'profile',
        'https://www.googleapis.com/auth/calendar.events',
        'https://www.googleapis.com/auth/meetings.space.readonly',
      ].join(' '),
      state,
    }).toString();
    return { authorizationUrl: url.toString(), expiresAt: new Date(expiresAt * 1000).toISOString() };
  }

  async complete(code: string, state: string): Promise<string> {
    if (!code || !state) throw new BadRequestError('Google callback thiếu code hoặc state.');
    const nowEpoch = Math.floor(this.now().getTime() / 1000);
    const userId = await this.store.consumeState(stateHash(state), nowEpoch);
    if (!userId) throw new BadRequestError('OAuth state không hợp lệ, đã dùng hoặc đã hết hạn.');
    const credentials = await this.credentials.get();
    const response = await this.fetcher('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
        redirect_uri: requiredEnvironment('GOOGLE_REDIRECT_URI'),
        grant_type: 'authorization_code',
      }),
    });
    const body = await response.json() as Record<string, unknown>;
    if (!response.ok || typeof body.access_token !== 'string' || typeof body.expires_in !== 'number') {
      throw new BadRequestError('Không thể đổi Google authorization code thành token.');
    }
    await this.store.saveTokens(userId, {
      accessToken: body.access_token,
      ...(typeof body.refresh_token === 'string' ? { refreshToken: body.refresh_token } : {}),
      expiresAt: new Date(this.now().getTime() + body.expires_in * 1000).toISOString(),
      ...(typeof body.scope === 'string' ? { scope: body.scope } : {}),
    });
    return userId;
  }
}
