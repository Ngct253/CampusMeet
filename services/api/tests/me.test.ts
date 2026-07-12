import { describe, expect, it } from 'vitest';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { meHandler } from '../src/handlers/me';
import { apiEvent } from './fixtures';

describe('me handler', () => {
  it('đọc danh tính từ JWT claims của API Gateway', async () => {
    const event = apiEvent('/me') as APIGatewayProxyEventV2WithJWTAuthorizer;
    event.requestContext.authorizer = { jwt: {
      claims: { sub: 'user-123', email: 'lan@example.edu', 'cognito:username': 'lan' },
      scopes: [],
    }, principalId: 'user-123', integrationLatency: 0 };
    const response = await meHandler(event, {} as never, () => undefined);
    if (!response || typeof response === 'string') throw new Error('Expected a structured response');
    expect(JSON.parse(response.body ?? '{}').data).toEqual({
      userId: 'user-123', email: 'lan@example.edu', username: 'lan',
    });
  });

  it('trả lỗi có cấu trúc khi thiếu JWT claims', async () => {
    const response = await meHandler(apiEvent('/me'), {} as never, () => undefined);
    if (!response || typeof response === 'string') throw new Error('Expected a structured response');
    expect(response.statusCode).toBe(401);
    expect(JSON.parse(response.body ?? '{}')).toMatchObject({
      success: false,
      error: { message: 'Không tìm thấy JWT claims đã xác thực.' },
    });
  });
});
