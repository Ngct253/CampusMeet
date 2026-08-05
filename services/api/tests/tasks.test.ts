import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Priority, TaskStatus, taskInputSchema, type CreateTaskRequest } from '@campusmeet/shared';
import { apiEvent } from './fixtures';

const send = vi.hoisted(() => vi.fn());
vi.mock('../src/repositories/client', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/repositories/client')>();
  return { ...original, documentClient: { send } };
});

import { tasksHandler } from '../src/handlers/tasks';
import { DynamoDbTaskRepository } from '../src/repositories/tasks';
import { tableName } from '../src/repositories/client';

const authenticatedEvent = (clientInput: Partial<APIGatewayProxyEventV2> = {}) => {
  const event = apiEvent('/tasks');
  event.requestContext.http.method = 'GET';
  const requestContext = event.requestContext as typeof event.requestContext & {
    authorizer: { jwt: { claims: Record<string, unknown>; scopes: string[] } };
  };
  requestContext.authorizer = { jwt: { claims: { sub: 'user-from-jwt' }, scopes: [] } };
  return Object.assign(event, clientInput);
};

describe('task list repository', () => {
  beforeEach(() => {
    send.mockReset();
    process.env.TASK_DATA_TABLE = 'campusmeet-test-task-data';
  });

  it('queries every GSI2 page for the authenticated assignee without Scan', async () => {
    send
      .mockResolvedValueOnce({
        Items: [
          {
            id: 'task-1',
            groupId: 'group-1',
            title: 'Việc một',
            assigneeId: 'user-from-jwt',
            status: TaskStatus.TODO,
            priority: Priority.HIGH,
            createdBy: 'admin-1',
            createdAt: '2026-08-03T00:00:00.000Z',
            updatedAt: '2026-08-03T00:00:00.000Z',
            version: 1,
          },
        ],
        LastEvaluatedKey: { PK: 'TASK#task-1', SK: 'META' },
      })
      .mockResolvedValueOnce({
        Items: [
          {
            id: 'task-2',
            groupId: 'group-1',
            title: 'Việc hai',
            assigneeId: 'user-from-jwt',
            status: TaskStatus.DOING,
            priority: Priority.MEDIUM,
            createdBy: 'admin-1',
            createdAt: '2026-08-03T00:00:00.000Z',
            updatedAt: '2026-08-03T00:00:00.000Z',
            version: 1,
          },
        ],
      });

    const result = await new DynamoDbTaskRepository().listByAssignee('user-from-jwt');
    const first = send.mock.calls[0]?.[0] as { input: Record<string, unknown>; constructor: { name: string } };
    const second = send.mock.calls[1]?.[0] as { input: Record<string, unknown> };

    expect(result.map(({ id }) => id)).toEqual(['task-1', 'task-2']);
    expect(send).toHaveBeenCalledTimes(2);
    expect(first.constructor.name).toBe('QueryCommand');
    expect(first.input).toMatchObject({
      TableName: 'campusmeet-test-task-data',
      IndexName: 'GSI2',
      KeyConditionExpression: 'GSI2PK = :assignee',
      ExpressionAttributeValues: { ':assignee': 'USER#user-from-jwt' },
    });
    expect(second.input.ExclusiveStartKey).toEqual({ PK: 'TASK#task-1', SK: 'META' });
    expect(send.mock.calls.flat().some((command) => command?.constructor?.name === 'ScanCommand')).toBe(
      false,
    );
  });

  it('keeps legacy tasks that do not have create metadata', async () => {
    send.mockResolvedValueOnce({
      Items: [
        {
          id: 'legacy-task',
          groupId: 'group-1',
          title: 'Legacy task',
          assigneeId: 'user-from-jwt',
          status: TaskStatus.TODO,
          priority: Priority.MEDIUM,
        },
      ],
    });

    await expect(
      new DynamoDbTaskRepository().listByAssignee('user-from-jwt'),
    ).resolves.toEqual([
      {
        id: 'legacy-task',
        groupId: 'group-1',
        title: 'Legacy task',
        assigneeId: 'user-from-jwt',
        status: TaskStatus.TODO,
        priority: Priority.MEDIUM,
      },
    ]);
  });

  it('stops when DynamoDB repeats the previous pagination key', async () => {
    const repeatedKey = { PK: 'TASK#task-1', SK: 'META' };
    send
      .mockResolvedValueOnce({ Items: [], LastEvaluatedKey: repeatedKey })
      .mockResolvedValueOnce({ Items: [], LastEvaluatedKey: { ...repeatedKey } });

    await expect(
      new DynamoDbTaskRepository().listByAssignee('user-from-jwt'),
    ).rejects.toThrow('Task pagination cursor did not advance.');
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('uses TASK_DATA_TABLE', () => {
    expect(tableName('TASK_DATA_TABLE')).toBe('campusmeet-test-task-data');
  });

  it('prefers MEETING_DATA_TABLE while preserving the legacy MEETING_TABLE name', () => {
    process.env.MEETING_DATA_TABLE = 'campusmeet-test-meeting-data';
    process.env.MEETING_TABLE = 'legacy-meeting-table';

    expect(tableName('MEETING_DATA_TABLE')).toBe('campusmeet-test-meeting-data');
    expect(tableName('MEETING_TABLE')).toBe('campusmeet-test-meeting-data');
  });
});

describe('task create contract', () => {
  it('normalizes valid input and rejects server-owned or unknown fields', () => {
    expect(
      taskInputSchema.parse({
        groupId: ' group-1 ',
        title: ' Hoàn thiện báo cáo ',
        assigneeId: ' user-2 ',
        priority: Priority.HIGH,
        dueAt: '2026-08-10T10:00:00.000Z',
        sourceMeetingId: ' meeting-1 ',
      }),
    ).toEqual({
      groupId: 'group-1',
      title: 'Hoàn thiện báo cáo',
      assigneeId: 'user-2',
      priority: Priority.HIGH,
      dueAt: '2026-08-10T10:00:00.000Z',
      sourceMeetingId: 'meeting-1',
    });

    for (const field of ['createdBy', 'role', 'status', 'version', 'unknown']) {
      expect(
        taskInputSchema.safeParse({
          groupId: 'group-1',
          title: 'Task',
          assigneeId: 'user-2',
          priority: Priority.HIGH,
          [field]: 'client-value',
        }).success,
      ).toBe(false);
    }
  });

  it('rejects empty ids, invalid title, dueAt, and priority', () => {
    const valid = {
      groupId: 'group-1',
      title: 'Task',
      assigneeId: 'user-2',
      priority: Priority.HIGH,
    };
    expect(taskInputSchema.safeParse({ ...valid, groupId: ' ' }).success).toBe(false);
    expect(taskInputSchema.safeParse({ ...valid, assigneeId: ' ' }).success).toBe(false);
    expect(taskInputSchema.safeParse({ ...valid, sourceMeetingId: ' ' }).success).toBe(false);
    expect(taskInputSchema.safeParse({ ...valid, title: ' ' }).success).toBe(false);
    expect(taskInputSchema.safeParse({ ...valid, title: 'x'.repeat(201) }).success).toBe(false);
    expect(taskInputSchema.safeParse({ ...valid, dueAt: '2026-08-10' }).success).toBe(false);
    expect(taskInputSchema.safeParse({ ...valid, priority: 'URGENT' }).success).toBe(false);
  });
});

describe('task create repository', () => {
  const input: CreateTaskRequest = {
    groupId: 'group-1',
    title: 'Hoàn thiện báo cáo',
    assigneeId: 'user-2',
    priority: Priority.HIGH,
  };

  beforeEach(() => {
    send.mockReset();
    process.env.TASK_DATA_TABLE = 'campusmeet-test-task-data';
  });

  it('writes TODO/version 1 with JWT creator and no-due sentinel only in indexes', async () => {
    send.mockResolvedValueOnce({});
    const task = await new DynamoDbTaskRepository().create('admin-1', input, 'key-1');
    const command = send.mock.calls[0]?.[0] as {
      constructor: { name: string };
      input: { Item: Record<string, unknown>; ConditionExpression: string };
    };

    expect(command.constructor.name).toBe('PutCommand');
    expect(command.input.ConditionExpression).toBe(
      'attribute_not_exists(PK) AND attribute_not_exists(SK)',
    );
    expect(command.input.Item).toMatchObject({
      PK: `TASK#${task.id}`,
      SK: 'META',
      entityType: 'TASK',
      createdBy: 'admin-1',
      status: TaskStatus.TODO,
      version: 1,
      GSI1PK: 'GROUP#group-1',
      GSI1SK: `STATUS#TODO#DUE#9999-12-31T23:59:59.999Z#TASK#${task.id}`,
      GSI2PK: 'USER#user-2',
      GSI2SK: `DUE#9999-12-31T23:59:59.999Z#TASK#${task.id}`,
    });
    expect(command.input.Item).not.toHaveProperty('dueAt');
    expect(command.input.Item).not.toHaveProperty('GSI3PK');
    expect(command.input.Item).not.toHaveProperty('GSI3SK');
    expect(task.dueAt).toBeUndefined();
    expect(task.updatedAt).toBe(task.createdAt);
    expect(task.createdAt).toMatch(/Z$/);
  });

  it('uses real dueAt and writes GSI3 for a source meeting', async () => {
    send.mockResolvedValueOnce({});
    const dueAt = '2026-08-10T10:00:00.000Z';
    const task = await new DynamoDbTaskRepository().create(
      'admin-1',
      { ...input, dueAt, sourceMeetingId: 'meeting-1' },
      'key-2',
    );
    const item = (send.mock.calls[0]?.[0] as { input: { Item: Record<string, unknown> } }).input
      .Item;

    expect(item).toMatchObject({
      dueAt,
      GSI1SK: `STATUS#TODO#DUE#${dueAt}#TASK#${task.id}`,
      GSI2SK: `DUE#${dueAt}#TASK#${task.id}`,
      GSI3PK: 'MEETING#meeting-1',
      GSI3SK: `TASK#${task.createdAt}#${task.id}`,
    });
  });

  it('returns the existing task for the same actor, key, and payload', async () => {
    send.mockResolvedValueOnce({});
    const repository = new DynamoDbTaskRepository();
    const created = await repository.create('admin-1', input, 'retry-key');
    const storedItem = (send.mock.calls[0]?.[0] as { input: { Item: Record<string, unknown> } })
      .input.Item;
    const conditionalError = Object.assign(new Error('conditional'), {
      name: 'ConditionalCheckFailedException',
    });
    send.mockReset();
    send.mockRejectedValueOnce(conditionalError).mockResolvedValueOnce({ Item: storedItem });

    await expect(repository.create('admin-1', input, 'retry-key')).resolves.toEqual(created);
    expect(send).toHaveBeenCalledTimes(2);
    const getCommand = send.mock.calls[1]?.[0] as {
      constructor: { name: string };
      input: { ConsistentRead?: boolean };
    };
    expect(getCommand.constructor.name).toBe('GetCommand');
    expect(getCommand.input.ConsistentRead).toBe(true);
  });

  it('treats equivalent UTC dueAt representations as the same payload', async () => {
    send.mockResolvedValueOnce({});
    const repository = new DynamoDbTaskRepository();
    await repository.create(
      'admin-1',
      { ...input, dueAt: '2026-08-10T10:00:00.000Z' },
      'timezone-key',
    );
    const storedItem = (send.mock.calls[0]?.[0] as { input: { Item: Record<string, unknown> } })
      .input.Item;
    send.mockReset();
    send
      .mockRejectedValueOnce(
        Object.assign(new Error('conditional'), { name: 'ConditionalCheckFailedException' }),
      )
      .mockResolvedValueOnce({ Item: storedItem });

    await expect(
      repository.create(
        'admin-1',
        { ...input, dueAt: '2026-08-10T17:00:00.000+07:00' },
        'timezone-key',
      ),
    ).resolves.toMatchObject({ id: storedItem.id });
  });

  it('returns 409 when the same key is reused with a different payload', async () => {
    send.mockResolvedValueOnce({});
    const repository = new DynamoDbTaskRepository();
    await repository.create('admin-1', input, 'conflict-key');
    const storedItem = (send.mock.calls[0]?.[0] as { input: { Item: Record<string, unknown> } })
      .input.Item;
    send.mockReset();
    send
      .mockRejectedValueOnce(
        Object.assign(new Error('conditional'), { name: 'ConditionalCheckFailedException' }),
      )
      .mockResolvedValueOnce({ Item: storedItem });

    await expect(
      repository.create('admin-1', { ...input, title: 'Payload khác' }, 'conflict-key'),
    ).rejects.toMatchObject({ code: 'CONFLICT', statusCode: 409 });
  });

  it('generates different task ids for different actors using the same key', async () => {
    send.mockResolvedValue({});
    const repository = new DynamoDbTaskRepository();
    const first = await repository.create('admin-1', input, 'shared-key');
    const second = await repository.create('admin-2', input, 'shared-key');
    expect(first.id).not.toBe(second.id);
  });

  it('rethrows the conditional error when the deterministic task is absent', async () => {
    const conditionalError = Object.assign(new Error('conditional'), {
      name: 'ConditionalCheckFailedException',
    });
    send.mockRejectedValueOnce(conditionalError).mockResolvedValueOnce({});
    await expect(
      new DynamoDbTaskRepository().create('admin-1', input, 'missing-key'),
    ).rejects.toBe(conditionalError);
  });
});

describe('GET /tasks handler', () => {
  beforeEach(() => {
    send.mockReset();
    process.env.TASK_DATA_TABLE = 'campusmeet-test-task-data';
  });

  it('returns 401 when JWT is missing', async () => {
    const event = apiEvent('/tasks');
    event.requestContext.http.method = 'GET';
    const response = await tasksHandler(event, {} as never, () => undefined);
    expect(response).toMatchObject({ statusCode: 401 });
  });

  it('ignores client userId and returns the standard response envelope', async () => {
    send.mockResolvedValueOnce({ Items: [] });
    const event = authenticatedEvent({
      rawQueryString: 'userId=other-user',
      queryStringParameters: { userId: 'other-user' },
      body: JSON.stringify({ userId: 'other-user' }),
    });
    const response = await tasksHandler(event, {} as never, () => undefined);
    const body = JSON.parse((response as { body: string }).body) as Record<string, unknown>;
    const command = send.mock.calls[0]?.[0] as { input: { ExpressionAttributeValues: unknown } };

    expect(command.input.ExpressionAttributeValues).toEqual({
      ':assignee': 'USER#user-from-jwt',
    });
    expect(response).toMatchObject({ statusCode: 200 });
    expect(body).toEqual({ success: true, data: [], requestId: 'test-request-id' });
  });
});

describe('POST /tasks handler', () => {
  const postEvent = () => {
    const event = authenticatedEvent();
    event.requestContext.http.method = 'POST';
    event.headers['idempotency-key'] = 'create-key';
    event.body = JSON.stringify({
      groupId: 'group-1',
      title: ' Task từ API ',
      assigneeId: 'user-2',
      priority: Priority.HIGH,
    });
    return event;
  };

  beforeEach(() => {
    send.mockReset();
    process.env.TASK_DATA_TABLE = 'campusmeet-test-task-data';
    process.env.COLLABORATION_TABLE = 'campusmeet-test-collaboration';
  });

  it('returns 401 when JWT is missing', async () => {
    const event = apiEvent('/tasks');
    event.requestContext.http.method = 'POST';
    event.headers['idempotency-key'] = 'create-key';
    event.body = JSON.stringify({
      groupId: 'group-1',
      title: 'Task',
      assigneeId: 'user-2',
      priority: Priority.HIGH,
    });
    const response = await tasksHandler(event, {} as never, () => undefined);
    expect(response).toMatchObject({ statusCode: 401 });
  });

  it('requires Idempotency-Key and rejects client-owned fields', async () => {
    const missingKey = postEvent();
    delete missingKey.headers['idempotency-key'];
    const missingKeyResponse = await tasksHandler(missingKey, {} as never, () => undefined);
    expect(missingKeyResponse).toMatchObject({ statusCode: 400 });

    const clientCreator = postEvent();
    clientCreator.body = JSON.stringify({
      groupId: 'group-1',
      title: 'Task',
      assigneeId: 'user-2',
      priority: Priority.HIGH,
      createdBy: 'other-user',
    });
    const creatorResponse = await tasksHandler(clientCreator, {} as never, () => undefined);
    expect(creatorResponse).toMatchObject({ statusCode: 400 });
    expect(send).not.toHaveBeenCalled();
  });

  it.each([
    ['outsider', undefined],
    [
      'member',
      {
        Item: {
          id: 'group-1:user-from-jwt',
          groupId: 'group-1',
          userId: 'user-from-jwt',
          role: 'MEMBER',
          active: true,
          joinedAt: '2026-08-01T00:00:00.000Z',
        },
      },
    ],
  ])('returns 403 for an active non-admin %s', async (_label, membership) => {
    send.mockResolvedValueOnce(membership ?? {});
    const response = await tasksHandler(postEvent(), {} as never, () => undefined);
    expect(response).toMatchObject({ statusCode: 403 });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('creates a normalized task with createdBy from JWT and the response envelope', async () => {
    const membership = (userId: string, role: 'GROUP_ADMIN' | 'MEMBER') => ({
      Item: {
        id: `group-1:${userId}`,
        groupId: 'group-1',
        userId,
        role,
        active: true,
        joinedAt: '2026-08-01T00:00:00.000Z',
      },
    });
    send
      .mockResolvedValueOnce(membership('user-from-jwt', 'GROUP_ADMIN'))
      .mockResolvedValueOnce(membership('user-2', 'MEMBER'))
      .mockResolvedValueOnce({});

    const response = await tasksHandler(postEvent(), {} as never, () => undefined);
    const body = JSON.parse((response as { body: string }).body) as {
      success: boolean;
      data: { createdBy: string; title: string; status: string; version: number };
      requestId: string;
    };

    expect(response).toMatchObject({ statusCode: 200 });
    expect(body).toMatchObject({
      success: true,
      data: {
        createdBy: 'user-from-jwt',
        title: 'Task từ API',
        status: 'TODO',
        version: 1,
      },
      requestId: 'test-request-id',
    });
    expect(body.data).not.toHaveProperty('idempotencyPayloadHash');
  });

  it('returns the same task for a retry with the same normalized title', async () => {
    const membership = (userId: string, role: 'GROUP_ADMIN' | 'MEMBER') => ({
      Item: {
        id: `group-1:${userId}`,
        groupId: 'group-1',
        userId,
        role,
        active: true,
        joinedAt: '2026-08-01T00:00:00.000Z',
      },
    });
    send
      .mockResolvedValueOnce(membership('user-from-jwt', 'GROUP_ADMIN'))
      .mockResolvedValueOnce(membership('user-2', 'MEMBER'))
      .mockResolvedValueOnce({});

    const firstResponse = await tasksHandler(postEvent(), {} as never, () => undefined);
    const firstBody = JSON.parse((firstResponse as { body: string }).body) as {
      data: Record<string, unknown>;
    };
    const storedItem = (send.mock.calls[2]?.[0] as { input: { Item: Record<string, unknown> } })
      .input.Item;
    const retryEvent = postEvent();
    retryEvent.body = JSON.stringify({
      groupId: 'group-1',
      title: 'Task từ API',
      assigneeId: 'user-2',
      priority: Priority.HIGH,
    });
    send
      .mockResolvedValueOnce(membership('user-from-jwt', 'GROUP_ADMIN'))
      .mockResolvedValueOnce(membership('user-2', 'MEMBER'))
      .mockRejectedValueOnce(
        Object.assign(new Error('conditional'), { name: 'ConditionalCheckFailedException' }),
      )
      .mockResolvedValueOnce({ Item: storedItem });

    const retryResponse = await tasksHandler(retryEvent, {} as never, () => undefined);
    const retryBody = JSON.parse((retryResponse as { body: string }).body) as {
      data: Record<string, unknown>;
    };

    expect(retryResponse).toMatchObject({ statusCode: 200 });
    expect(retryBody.data).toEqual(firstBody.data);
    expect(firstBody.data).not.toHaveProperty('idempotencyPayloadHash');
    expect(retryBody.data).not.toHaveProperty('idempotencyPayloadHash');
  });
});
