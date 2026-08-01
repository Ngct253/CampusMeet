import { describe, expect, it, vi } from 'vitest';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { apiEvent } from './fixtures';

const identityMocks = vi.hoisted(() => ({
  ensureProfile: vi.fn(),
  updateProfile: vi.fn(),
}));
vi.mock('../src/repositories/identity', () => ({
  DynamoDbIdentityRepository: class {
    ensureProfile = identityMocks.ensureProfile;
    updateProfile = identityMocks.updateProfile;
  },
}));

import { meHandler } from '../src/handlers/me';

const profile = {
  id: 'user-123',
  email: 'lan@example.edu',
  displayName: 'Lan',
  timezone: 'Asia/Ho_Chi_Minh',
  emailNotificationsEnabled: true,
};

const authenticatedEvent = () => {
  const event = apiEvent('/me') as APIGatewayProxyEventV2WithJWTAuthorizer;
  event.requestContext.authorizer = { jwt: {
    claims: { sub: 'user-123', email: 'lan@example.edu', 'cognito:username': 'lan' },
    scopes: [],
  }, principalId: 'user-123', integrationLatency: 0 };
  return event;
};

describe('me handler', () => {
  it('trả hồ sơ M1 của danh tính trong JWT', async () => {
    identityMocks.ensureProfile.mockResolvedValue(profile);
    const response = await meHandler(authenticatedEvent(), {} as never, () => undefined);
    if (!response || typeof response === 'string') throw new Error('Expected a structured response');
    expect(JSON.parse(response.body ?? '{}').data).toEqual(profile);
    expect(identityMocks.ensureProfile).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-123' }));
  });

  it('trả lỗi có cấu trúc khi thiếu JWT claims', async () => {
    const response = await meHandler(apiEvent('/me'), {} as never, () => undefined);
    if (!response || typeof response === 'string') throw new Error('Expected a structured response');
    expect(response.statusCode).toBe(401);
    expect(JSON.parse(response.body ?? '{}')).toMatchObject({
      success: false,
      error: { code: 'UNAUTHORIZED' },
    });
  });
});
