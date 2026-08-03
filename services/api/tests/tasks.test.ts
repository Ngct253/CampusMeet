import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Priority, TaskStatus } from '@campusmeet/shared';
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
