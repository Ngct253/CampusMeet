import { isDeepStrictEqual } from 'node:util';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { Priority, TaskStatus, type Task } from '@campusmeet/shared';
import type { TaskRepository } from '../domain/ports';
import { documentClient, stringValue, tableName, type DynamoItem } from './client';

const toTask = (item: DynamoItem): Task | undefined => {
  const id = stringValue(item, 'id') ?? stringValue(item, 'PK')?.replace(/^TASK#/, '');
  const groupId = stringValue(item, 'groupId');
  const title = stringValue(item, 'title');
  const assigneeId = stringValue(item, 'assigneeId');
  const status = stringValue(item, 'status') as TaskStatus | undefined;
  const priority = stringValue(item, 'priority') as Priority | undefined;
  if (!id || !groupId || !title || !assigneeId || !status || !priority) return undefined;

  return {
    id,
    groupId,
    title,
    assigneeId,
    status,
    priority,
    ...(stringValue(item, 'dueAt') ? { dueAt: stringValue(item, 'dueAt') } : {}),
    ...(stringValue(item, 'sourceMeetingId')
      ? { sourceMeetingId: stringValue(item, 'sourceMeetingId') }
      : {}),
  };
};

export class DynamoDbTaskRepository implements TaskRepository {
  async listByAssignee(userId: string): Promise<Task[]> {
    const tasks: Task[] = [];
    let exclusiveStartKey: Record<string, unknown> | undefined;

    do {
      const page = await documentClient.send(
        new QueryCommand({
          TableName: tableName('TASK_DATA_TABLE'),
          IndexName: 'GSI2',
          KeyConditionExpression: 'GSI2PK = :assignee',
          ExpressionAttributeValues: { ':assignee': `USER#${userId}` },
          ExclusiveStartKey: exclusiveStartKey,
        }),
      );
      tasks.push(
        ...(page.Items ?? []).flatMap((item) => {
          const task = toTask(item);
          return task ? [task] : [];
        }),
      );
      const nextStartKey = page.LastEvaluatedKey;
      if (
        exclusiveStartKey !== undefined &&
        nextStartKey !== undefined &&
        isDeepStrictEqual(nextStartKey, exclusiveStartKey)
      ) {
        throw new Error('Task pagination cursor did not advance.');
      }
      exclusiveStartKey = nextStartKey;
    } while (exclusiveStartKey);

    return tasks;
  }
}
