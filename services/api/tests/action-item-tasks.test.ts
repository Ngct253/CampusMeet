import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Priority, TaskStatus } from '@campusmeet/shared';
import { createActionItemTaskHandler } from '../src/handlers/action-item-tasks';
import { apiEvent } from './fixtures';

const responseData = {
  task: {
    id: 'task-1',
    groupId: 'group-1',
    title: 'Task',
    assigneeId: 'user-1',
    priority: Priority.HIGH,
    status: TaskStatus.TODO,
    sourceMeetingId: 'meeting-1',
    sourceActionItemId: 'action-1',
    createdBy: 'user-from-jwt',
    version: 1,
  },
  minutes: {
    id: 'minutes-1',
    meetingId: 'meeting-1',
    groupId: 'group-1',
    summary: 'Summary',
    discussion: '',
    decisions: [],
    actionItems: [{ id: 'action-1', content: 'Task', taskId: 'task-1' }],
    version: 3,
    createdBy: 'user-from-jwt',
    createdAt: '2026-08-06T05:00:00.000Z',
  },
};

const eventFor = () => {
  const event = apiEvent(
    '/meetings/meeting-1/minutes/action-items/action-1/task',
  ) as APIGatewayProxyEventV2;
  event.requestContext.http.method = 'POST';
  event.pathParameters = { meetingId: 'meeting-1', actionItemId: 'action-1' };
  event.body = JSON.stringify({ expectedMinutesVersion: 2, priority: Priority.HIGH });
  const context = event.requestContext as typeof event.requestContext & {
    authorizer: { jwt: { claims: Record<string, unknown>; scopes: string[] } };
  };
  context.authorizer = { jwt: { claims: { sub: 'user-from-jwt' }, scopes: [] } };
  return event;
};

describe('POST Action Item to Task handler', () => {
  const service = { convert: vi.fn().mockResolvedValue(responseData) };
  const handler = createActionItemTaskHandler(service);

  beforeEach(() => {
    vi.clearAllMocks();
    service.convert.mockResolvedValue(responseData);
  });

  it.each([
    ['missing JWT', undefined],
    ['malformed JWT sub', 123],
  ])('returns 401 for %s', async (_label, sub) => {
    const event = eventFor();
    const context = event.requestContext as typeof event.requestContext & {
      authorizer?: { jwt?: { claims?: Record<string, unknown> } };
    };
    if (sub === undefined) delete context.authorizer;
    else context.authorizer = { jwt: { claims: { sub } } };
    const response = await handler(event, {} as never, () => undefined);
    expect(response).toMatchObject({ statusCode: 401 });
    expect(JSON.parse((response as { body: string }).body)).toMatchObject({
      success: false,
      error: { code: 'UNAUTHORIZED' },
      requestId: 'test-request-id',
    });
    expect(service.convert).not.toHaveBeenCalled();
  });

  it('uses JWT actor and both path IDs, returning the standard success envelope', async () => {
    const response = await handler(eventFor(), {} as never, () => undefined);
    expect(service.convert).toHaveBeenCalledWith('user-from-jwt', 'meeting-1', 'action-1', {
      expectedMinutesVersion: 2,
      priority: Priority.HIGH,
    });
    expect(response).toMatchObject({ statusCode: 200 });
    expect(JSON.parse((response as { body: string }).body)).toEqual({
      success: true,
      data: responseData,
      requestId: 'test-request-id',
    });
  });

  it('normalizes optional fields and rejects client-managed or unknown fields', async () => {
    const normalized = eventFor();
    normalized.body = JSON.stringify({
      expectedMinutesVersion: 2,
      priority: Priority.MEDIUM,
      assigneeId: ' user-1 ',
      title: ' Task ',
    });
    await handler(normalized, {} as never, () => undefined);
    expect(service.convert).toHaveBeenLastCalledWith('user-from-jwt', 'meeting-1', 'action-1', {
      expectedMinutesVersion: 2,
      priority: Priority.MEDIUM,
      assigneeId: 'user-1',
      title: 'Task',
    });

    for (const field of ['meetingId', 'taskId', 'createdBy', 'sourceActionItemId']) {
      service.convert.mockClear();
      const forged = eventFor();
      forged.body = JSON.stringify({
        expectedMinutesVersion: 2,
        priority: Priority.HIGH,
        [field]: 'forged',
      });
      const response = await handler(forged, {} as never, () => undefined);
      expect(response).toMatchObject({ statusCode: 400 });
      expect(service.convert).not.toHaveBeenCalled();
    }
  });

  it('returns replay success unchanged and rejects other methods', async () => {
    const replay = { ...responseData, minutes: { ...responseData.minutes, version: 4 } };
    service.convert.mockResolvedValueOnce(replay);
    const response = await handler(eventFor(), {} as never, () => undefined);
    expect(JSON.parse((response as { body: string }).body).data).toEqual(replay);

    const wrongMethod = eventFor();
    wrongMethod.requestContext.http.method = 'GET';
    const rejected = await handler(wrongMethod, {} as never, () => undefined);
    expect(rejected).toMatchObject({ statusCode: 405 });
    expect(service.convert).toHaveBeenCalledTimes(1);
  });
});
