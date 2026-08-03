import { describe, expect, it } from 'vitest';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { GroupRole, MeetingStatus } from '@campusmeet/shared';
import { MeetingService } from '../src/application/meeting-service';
import { createMeetingsHandler } from '../src/handlers/meetings';
import {
  InMemoryMeetingRepository,
  InMemoryMembershipAuthorizer,
} from '../src/repositories/in-memory';
import { apiEvent } from './fixtures';
const event = (
  method: string,
  body?: unknown,
  query?: Record<string, string>,
  userId = 'admin',
) => {
  const value = apiEvent('/meetings') as APIGatewayProxyEventV2WithJWTAuthorizer;
  value.requestContext.http.method = method;
  value.requestContext.authorizer = {
    jwt: { claims: { sub: userId }, scopes: [] },
    principalId: userId,
    integrationLatency: 0,
  };
  value.body = body ? JSON.stringify(body) : undefined;
  value.queryStringParameters = query;
  return value;
};
const setupHandler = () => {
  const memberships = new InMemoryMembershipAuthorizer();
  memberships.add('g1', 'admin', GroupRole.GROUP_ADMIN);
  memberships.add('g1', 'member');
  memberships.add('g2', 'group-b-admin', GroupRole.GROUP_ADMIN);
  const service = new MeetingService(
    new InMemoryMeetingRepository(),
    memberships,
    () => new Date('2029-01-01'),
    () => 'm1',
  );
  return { service, handler: createMeetingsHandler(service) };
};
const handler = () => setupHandler().handler;
const call = async (e: ReturnType<typeof event>) => {
  const result = await handler()(e, {} as never, () => undefined);
  if (!result || typeof result === 'string') throw new Error('structured response expected');
  return {
    status: result.statusCode,
    body: JSON.parse(result.body ?? '{}') as Record<string, unknown>,
  };
};
describe('meetings handler', () => {
  it('create trả đúng contract', async () => {
    const r = await call(
      event('POST', {
        groupId: 'g1',
        title: 'Plan',
        organizerId: 'admin',
        attendeeIds: ['member'],
        agenda: [],
        startsAt: '2030-01-01T10:00:00Z',
        endsAt: '2030-01-01T11:00:00Z',
        status: MeetingStatus.SCHEDULED,
      }),
    );
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ success: true, requestId: 'test-request-id' });
  });
  it('invalid request trả error format 400', async () => {
    const r = await call(event('POST', {}));
    expect(r.status).toBe(400);
    expect(r.body).toMatchObject({
      success: false,
      error: { code: 'VALIDATION_ERROR' },
      requestId: 'test-request-id',
    });
  });
  it('thiếu auth trả 401', async () => {
    const e = apiEvent('/meetings');
    e.queryStringParameters = { groupId: 'g1' };
    const result = await handler()(e, {} as never, () => undefined);
    if (!result || typeof result === 'string') throw new Error();
    expect(result.statusCode).toBe(401);
  });
  it('trả 403 cho detail, update và cancel meeting group A khi user chỉ thuộc group B', async () => {
    const setup = setupHandler();
    await setup.service.create(
      {
        groupId: 'g1',
        title: 'Plan',
        organizerId: 'admin',
        attendeeIds: ['member'],
        agenda: [],
        startsAt: '2030-01-01T10:00:00Z',
        endsAt: '2030-01-01T11:00:00Z',
        status: MeetingStatus.SCHEDULED,
      },
      'admin',
    );
    for (const request of [
      event('GET', undefined, { meetingId: 'm1' }, 'group-b-admin'),
      event('PATCH', { title: 'Cross group', version: 1 }, { meetingId: 'm1' }, 'group-b-admin'),
      event('DELETE', { version: 1 }, { meetingId: 'm1' }, 'group-b-admin'),
    ]) {
      const result = await setup.handler(request, {} as never, () => undefined);
      if (!result || typeof result === 'string') throw new Error('structured response expected');
      expect(result.statusCode).toBe(403);
      expect(JSON.parse(result.body ?? '{}')).toMatchObject({
        success: false,
        error: { code: 'FORBIDDEN' },
      });
    }
  });
});
