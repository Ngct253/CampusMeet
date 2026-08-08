import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GroupRole,
  Priority,
  TaskStatus,
  updateTaskStatusInputSchema,
  type Task,
} from '@campusmeet/shared';
import { apiEvent } from './fixtures';

const send = vi.hoisted(() => vi.fn());
vi.mock('../src/repositories/client', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/repositories/client')>();
  return { ...original, documentClient: { send } };
});

import { taskStatusHandler } from '../src/handlers/tasks';
import { handler as apiHandler } from '../src/index';
import { DynamoDbTaskRepository } from '../src/repositories/tasks';

const currentTask: Task = {
  id: 'task-1',
  groupId: 'group-1',
  title: 'Hoàn thiện báo cáo',
  assigneeId: 'user-from-jwt',
  status: TaskStatus.TODO,
  priority: Priority.HIGH,
  dueAt: '2026-08-10T10:00:00.000Z',
  createdBy: 'admin-1',
  createdAt: '2026-08-03T00:00:00.000Z',
  updatedAt: '2026-08-03T00:00:00.000Z',
  version: 1,
};

const taskItem = (task: Task = currentTask) => ({
  PK: `TASK#${task.id}`,
  SK: 'META',
  entityType: 'TASK',
  ...task,
  GSI1PK: `GROUP#${task.groupId}`,
  GSI1SK: `STATUS#${task.status}#DUE#${task.dueAt ?? '9999-12-31T23:59:59.999Z'}#TASK#${task.id}`,
  GSI2PK: `USER#${task.assigneeId}`,
  GSI2SK: `DUE#${task.dueAt ?? '9999-12-31T23:59:59.999Z'}#TASK#${task.id}`,
});

const membershipItem = (userId: string, role = GroupRole.MEMBER) => ({
  Item: {
    id: `group-1:${userId}`,
    groupId: 'group-1',
    userId,
    role,
    active: true,
    joinedAt: '2026-08-01T00:00:00.000Z',
  },
});

const patchEvent = (body: unknown = { status: TaskStatus.DOING, expectedVersion: 1 }) => {
  const event = apiEvent('/tasks/task-1/status');
  event.requestContext.http.method = 'PATCH';
  event.pathParameters = { taskId: 'task-1' };
  event.body = JSON.stringify(body);
  const requestContext = event.requestContext as typeof event.requestContext & {
    authorizer: { jwt: { claims: Record<string, unknown>; scopes: string[] } };
  };
  requestContext.authorizer = {
    jwt: { claims: { sub: 'user-from-jwt' }, scopes: [] },
  };
  return event;
};

describe('task status contract', () => {
  it('is strict, accepts localized workflow payloads, and rejects invalid completion data', () => {
    expect(
      updateTaskStatusInputSchema.parse({ status: TaskStatus.DOING, expectedVersion: 0 }),
    ).toEqual({ status: TaskStatus.DOING, expectedVersion: 0 });
    expect(
      updateTaskStatusInputSchema.safeParse({ status: 'IN_PROGRESS', expectedVersion: 1 }).success,
    ).toBe(false);
    expect(updateTaskStatusInputSchema.safeParse({ status: TaskStatus.DOING }).success).toBe(false);
    expect(
      updateTaskStatusInputSchema.safeParse({
        status: TaskStatus.DOING,
        expectedVersion: -1,
      }).success,
    ).toBe(false);
    expect(
      updateTaskStatusInputSchema.safeParse({
        status: TaskStatus.DONE,
        expectedVersion: 1,
        actorId: 'client-user',
      }).success,
    ).toBe(false);
    expect(
      updateTaskStatusInputSchema.safeParse({
        status: TaskStatus.DONE,
        expectedVersion: 1,
      }).success,
    ).toBe(false);
    expect(
      updateTaskStatusInputSchema.parse({
        status: TaskStatus.DONE,
        expectedVersion: 1,
        completionNote: '  Đã bàn giao bản demo.  ',
        completionEvidenceUrl: 'https://example.com/demo',
      }),
    ).toEqual({
      status: TaskStatus.DONE,
      expectedVersion: 1,
      completionNote: 'Đã bàn giao bản demo.',
      completionEvidenceUrl: 'https://example.com/demo',
    });
    expect(
      updateTaskStatusInputSchema.safeParse({
        status: TaskStatus.DOING,
        expectedVersion: 1,
        completionNote: 'Không được gửi khi đang làm',
      }).success,
    ).toBe(false);
  });
});

describe('task status repository', () => {
  beforeEach(() => {
    send.mockReset();
    process.env.TASK_DATA_TABLE = 'campusmeet-test-task-data';
  });

  it('atomically updates META and writes history with the JWT actor', async () => {
    send.mockResolvedValueOnce({});

    const updated = await new DynamoDbTaskRepository().updateStatus(
      currentTask,
      'user-from-jwt',
      TaskStatus.DONE,
      1,
      false,
      'Đã bàn giao bản demo.',
      'https://example.com/demo',
    );
    const command = send.mock.calls[0]?.[0] as {
      constructor: { name: string };
      input: { TransactItems: Array<Record<string, Record<string, unknown>>> };
    };
    const update = command.input.TransactItems[0]?.Update;
    const history = command.input.TransactItems[1]?.Put;
    const historyItem = history?.Item as Record<string, unknown>;

    expect(command.constructor.name).toBe('TransactWriteCommand');
    expect(update).toMatchObject({
      TableName: 'campusmeet-test-task-data',
      Key: { PK: 'TASK#task-1', SK: 'META' },
      ConditionExpression:
        'attribute_exists(PK) AND #version = :expectedVersion AND #status = :fromStatus',
    });
    expect(update?.UpdateExpression).toContain('completedAt = :completedAt');
    expect(update?.UpdateExpression).toContain('completionNote = :completionNote');
    expect(update?.UpdateExpression).toContain('completionEvidenceUrl = :completionEvidenceUrl');
    expect(update?.UpdateExpression).not.toContain('GSI2PK');
    expect(update?.UpdateExpression).not.toContain('GSI2SK');
    expect(update?.UpdateExpression).not.toContain('GSI3PK');
    expect(update?.UpdateExpression).not.toContain('GSI3SK');
    expect(update?.ExpressionAttributeValues).toMatchObject({
      ':status': TaskStatus.DONE,
      ':fromStatus': TaskStatus.TODO,
      ':expectedVersion': 1,
      ':nextVersion': 2,
      ':gsi1sk': `STATUS#DONE#DUE#${currentTask.dueAt}#TASK#task-1`,
      ':completionNote': 'Đã bàn giao bản demo.',
      ':completionEvidenceUrl': 'https://example.com/demo',
    });
    expect(history?.ConditionExpression).toBe(
      'attribute_not_exists(PK) AND attribute_not_exists(SK)',
    );
    expect(historyItem).toMatchObject({
      PK: 'TASK#task-1',
      entityType: 'TASK_EVENT',
      eventType: 'STATUS_CHANGED',
      taskId: 'task-1',
      groupId: 'group-1',
      actorId: 'user-from-jwt',
      fromStatus: TaskStatus.TODO,
      toStatus: TaskStatus.DONE,
      version: 2,
      completionNote: 'Đã bàn giao bản demo.',
      completionEvidenceUrl: 'https://example.com/demo',
    });
    expect(historyItem.SK).toEqual(expect.stringMatching(/^EVENT#.+Z#[0-9a-f-]{36}$/));
    expect(updated).toMatchObject({
      status: TaskStatus.DONE,
      version: 2,
      completionNote: 'Đã bàn giao bản demo.',
      completionEvidenceUrl: 'https://example.com/demo',
    });
    expect(updated.completedAt).toBe(updated.updatedAt);
    expect(send.mock.calls.flat().some((value) => value?.constructor?.name === 'ScanCommand')).toBe(
      false,
    );
  });

  it('removes completedAt when reopening DONE -> DOING', async () => {
    send.mockResolvedValueOnce({});
    const doneTask = {
      ...currentTask,
      status: TaskStatus.DONE,
      completedAt: '2026-08-04T00:00:00.000Z',
    };

    const updated = await new DynamoDbTaskRepository().updateStatus(
      doneTask,
      'user-from-jwt',
      TaskStatus.DOING,
      1,
      false,
    );
    const transaction = send.mock.calls[0]?.[0] as {
      input: { TransactItems: Array<{ Update?: { UpdateExpression: string } }> };
    };

    expect(transaction.input.TransactItems[0]?.Update?.UpdateExpression).toContain(
      'REMOVE completedAt',
    );
    expect(updated.completedAt).toBeUndefined();
  });

  it('uses the no-due sentinel when rebuilding GSI1SK', async () => {
    send.mockResolvedValueOnce({});
    const noDue = { ...currentTask, dueAt: undefined };

    await new DynamoDbTaskRepository().updateStatus(
      noDue,
      'user-from-jwt',
      TaskStatus.DOING,
      1,
      false,
    );
    const transaction = send.mock.calls[0]?.[0] as {
      input: {
        TransactItems: Array<{
          Update?: { ExpressionAttributeValues: Record<string, unknown> };
        }>;
      };
    };

    expect(transaction.input.TransactItems[0]?.Update?.ExpressionAttributeValues[':gsi1sk']).toBe(
      'STATUS#DOING#DUE#9999-12-31T23:59:59.999Z#TASK#task-1',
    );
  });

  it('migrates a legacy task without version using attribute_not_exists(version)', async () => {
    send.mockResolvedValueOnce({});
    const legacy = { ...currentTask, version: undefined };

    const updated = await new DynamoDbTaskRepository().updateStatus(
      legacy,
      'user-from-jwt',
      TaskStatus.DOING,
      0,
      true,
    );
    const transaction = send.mock.calls[0]?.[0] as {
      input: {
        TransactItems: Array<{
          Update?: {
            ConditionExpression: string;
            ExpressionAttributeValues: Record<string, unknown>;
          };
        }>;
      };
    };
    const update = transaction.input.TransactItems[0]?.Update;

    expect(update?.ConditionExpression).toContain('attribute_not_exists(#version)');
    expect(update?.ExpressionAttributeValues).not.toHaveProperty(':expectedVersion');
    expect(updated.version).toBe(1);
  });

  it('maps a confirmed version/status race to 409 using a consistent read', async () => {
    const cancellation = Object.assign(new Error('cancelled'), {
      name: 'TransactionCanceledException',
    });
    send
      .mockRejectedValueOnce(cancellation)
      .mockResolvedValueOnce({ Item: taskItem({ ...currentTask, version: 2 }) });

    await expect(
      new DynamoDbTaskRepository().updateStatus(
        currentTask,
        'user-from-jwt',
        TaskStatus.DOING,
        1,
        false,
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT', statusCode: 409 });
    const read = send.mock.calls[1]?.[0] as {
      constructor: { name: string };
      input: { ConsistentRead?: boolean };
    };
    expect(read.constructor.name).toBe('GetCommand');
    expect(read.input.ConsistentRead).toBe(true);
  });

  it('does not map an unrelated transaction cancellation to 409', async () => {
    const cancellation = Object.assign(new Error('capacity or history condition'), {
      name: 'TransactionCanceledException',
    });
    send.mockRejectedValueOnce(cancellation).mockResolvedValueOnce({ Item: taskItem() });

    await expect(
      new DynamoDbTaskRepository().updateStatus(
        currentTask,
        'user-from-jwt',
        TaskStatus.DOING,
        1,
        false,
      ),
    ).rejects.toBe(cancellation);
  });

  it('maps cancellation recovery with persisted version 0 to 409', async () => {
    const cancellation = Object.assign(new Error('cancelled'), {
      name: 'TransactionCanceledException',
    });
    const legacy: Task = { ...currentTask };
    delete legacy.version;
    send
      .mockRejectedValueOnce(cancellation)
      .mockResolvedValueOnce({ Item: taskItem({ ...currentTask, version: 0 }) });

    await expect(
      new DynamoDbTaskRepository().updateStatus(legacy, 'user-from-jwt', TaskStatus.DOING, 0, true),
    ).rejects.toMatchObject({ code: 'CONFLICT', statusCode: 409 });
  });
});

describe('PATCH /tasks/:taskId/status handler', () => {
  beforeEach(() => {
    send.mockReset();
    process.env.TASK_DATA_TABLE = 'campusmeet-test-task-data';
    process.env.COLLABORATION_TABLE = 'campusmeet-test-collaboration';
  });

  it('returns 401 when JWT is missing', async () => {
    const event = patchEvent();
    delete (
      event.requestContext as Partial<typeof event.requestContext> & {
        authorizer?: unknown;
      }
    ).authorizer;

    const response = await taskStatusHandler(event, {} as never, () => undefined);
    expect(response).toMatchObject({ statusCode: 401 });
    expect(send).not.toHaveBeenCalled();
  });

  it('is registered on the exact PATCH status route', async () => {
    const event = apiEvent('/tasks/task-1/status');
    event.requestContext.http.method = 'PATCH';
    event.body = JSON.stringify({ status: TaskStatus.DOING, expectedVersion: 1 });

    const response = await apiHandler(event, {} as never, () => undefined);
    expect(response).toMatchObject({ statusCode: 401 });
  });

  it('returns 404 when the task does not exist', async () => {
    send.mockResolvedValueOnce({});

    const response = await taskStatusHandler(patchEvent(), {} as never, () => undefined);
    expect(response).toMatchObject({ statusCode: 404 });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('updates as the assignee and returns the standard envelope', async () => {
    send
      .mockResolvedValueOnce({ Item: taskItem() })
      .mockResolvedValueOnce(membershipItem('user-from-jwt'))
      .mockResolvedValueOnce({});

    const response = await taskStatusHandler(patchEvent(), {} as never, () => undefined);
    const body = JSON.parse((response as { body: string }).body) as {
      success: boolean;
      data: Task;
      requestId: string;
    };

    expect(response).toMatchObject({ statusCode: 200 });
    expect(body).toMatchObject({
      success: true,
      data: { id: 'task-1', status: TaskStatus.DOING, version: 2 },
      requestId: 'test-request-id',
    });
    const transaction = send.mock.calls[2]?.[0] as {
      input: { TransactItems: Array<{ Put?: { Item: Record<string, unknown> } }> };
    };
    expect(transaction.input.TransactItems[1]?.Put?.Item.actorId).toBe('user-from-jwt');
  });

  it('rejects unknown request fields before reading DynamoDB', async () => {
    const response = await taskStatusHandler(
      patchEvent({ status: TaskStatus.DOING, expectedVersion: 1, role: GroupRole.GROUP_ADMIN }),
      {} as never,
      () => undefined,
    );

    expect(response).toMatchObject({ statusCode: 400 });
    expect(send).not.toHaveBeenCalled();
  });
});
