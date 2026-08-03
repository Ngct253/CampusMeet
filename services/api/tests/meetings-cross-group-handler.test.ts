import { beforeAll, describe, expect, it } from 'vitest';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { GroupRole } from '@campusmeet/shared';
import { MeetingService } from '../src/application/meeting-service';
import {
  InMemoryMeetingRepository,
  InMemoryMembershipAuthorizer,
} from '../src/repositories/in-memory';
import { apiEvent } from './fixtures';

process.env.MEETING_DATA_TABLE = 'meeting-data-test';
process.env.COLLABORATION_TABLE = 'collaboration-test';

let createMeetingDetailHandler: typeof import('../src/handlers/meetings').createMeetingDetailHandler;
let createCancelMeetingHandler: typeof import('../src/handlers/meetings').createCancelMeetingHandler;

beforeAll(async () => {
  ({ createMeetingDetailHandler, createCancelMeetingHandler } = await import(
    '../src/handlers/meetings'
  ));
});

const event = (method: string, userId: string, body?: unknown) => {
  const value = apiEvent('/meetings/m1') as APIGatewayProxyEventV2WithJWTAuthorizer;
  value.requestContext.http.method = method;
  value.pathParameters = { meetingId: 'm1' };
  value.requestContext.authorizer = {
    jwt: { claims: { sub: userId }, scopes: [] },
    principalId: userId,
    integrationLatency: 0,
  };
  value.body = body === undefined ? undefined : JSON.stringify(body);
  return value;
};

describe('meeting handler cross-group authorization', () => {
  it('trả structured 403 cho member Group B đọc, sửa hoặc hủy meeting Group A', async () => {
    const memberships = new InMemoryMembershipAuthorizer();
    memberships.add('group-a', 'admin-a', GroupRole.GROUP_ADMIN);
    memberships.add('group-a', 'member-a');
    memberships.add('group-b', 'admin-b', GroupRole.GROUP_ADMIN);
    const service = new MeetingService(
      new InMemoryMeetingRepository(),
      memberships,
      () => new Date('2029-01-01T00:00:00.000Z'),
      () => 'm1',
    );
    await service.create(
      'group-a',
      'admin-a',
      {
        title: 'Group A planning',
        attendeeIds: ['member-a'],
        startsAt: '2030-01-01T10:00:00.000Z',
        endsAt: '2030-01-01T11:00:00.000Z',
      },
    );
    const requests = [
      [createMeetingDetailHandler(service), event('GET', 'admin-b')],
      [createMeetingDetailHandler(service), event('PATCH', 'admin-b', { title: 'Forbidden' })],
      [createCancelMeetingHandler(service), event('POST', 'admin-b', {})],
    ] as const;
    for (const [handler, request] of requests) {
      const response = await handler(request, {} as never, () => undefined);
      if (!response || typeof response === 'string') throw new Error('Expected structured response');
      expect(response.statusCode).toBe(403);
      expect(JSON.parse(response.body ?? '{}')).toMatchObject({
        success: false,
        error: { code: 'FORBIDDEN' },
        requestId: 'test-request-id',
      });
    }
  });
});
