import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import {
  type DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  Priority,
  TaskStatus,
  taskInputSchema,
  type CreateTaskRequest,
  type Task,
} from '@campusmeet/shared';
import type { GroupTaskReader, TaskRepository } from '../domain/ports';
import { ConflictError, ResourceNotFoundError } from '../utils/errors';
import { documentClient, stringValue, tableName, type DynamoItem } from './client';

const NO_DUE_DATE_SORT_VALUE = '9999-12-31T23:59:59.999Z';
type PersistedTask = Task &
  Required<Pick<Task, 'createdBy' | 'createdAt' | 'updatedAt' | 'version'>>;

const toTask = (item: DynamoItem): Task | undefined => {
  const id = stringValue(item, 'id') ?? stringValue(item, 'PK')?.replace(/^TASK#/, '');
  const groupId = stringValue(item, 'groupId');
  const title = stringValue(item, 'title');
  const assigneeId = stringValue(item, 'assigneeId');
  const status = stringValue(item, 'status') as TaskStatus | undefined;
  const priority = stringValue(item, 'priority') as Priority | undefined;
  const createdBy = stringValue(item, 'createdBy');
  const createdAt = stringValue(item, 'createdAt');
  const updatedAt = stringValue(item, 'updatedAt');
  const completedAt = stringValue(item, 'completedAt');
  const completionNote = stringValue(item, 'completionNote');
  const completionEvidenceUrl = stringValue(item, 'completionEvidenceUrl');
  const version = typeof item.version === 'number' ? item.version : undefined;
  if (!id || !groupId || !title || !assigneeId || !status || !priority) {
    return undefined;
  }

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
    ...(stringValue(item, 'sourceActionItemId')
      ? { sourceActionItemId: stringValue(item, 'sourceActionItemId') }
      : {}),
    ...(createdBy ? { createdBy } : {}),
    ...(createdAt ? { createdAt } : {}),
    ...(updatedAt ? { updatedAt } : {}),
    ...(completedAt ? { completedAt } : {}),
    ...(completionNote ? { completionNote } : {}),
    ...(completionEvidenceUrl ? { completionEvidenceUrl } : {}),
    ...(version !== undefined ? { version } : {}),
  };
};

const taskIdFor = (actorId: string, idempotencyKey: string) =>
  createHash('sha256')
    .update(`CREATE_TASK:${actorId}:${idempotencyKey}`)
    .digest('hex')
    .slice(0, 32);

const payloadHashFor = (input: CreateTaskRequest) =>
  createHash('sha256')
    .update(
      JSON.stringify({
        groupId: input.groupId,
        title: input.title,
        assigneeId: input.assigneeId,
        priority: input.priority,
        dueAt: input.dueAt ? new Date(input.dueAt).toISOString() : null,
        sourceMeetingId: input.sourceMeetingId ?? null,
      }),
    )
    .digest('hex');

const taskItem = (task: PersistedTask, idempotencyPayloadHash: string) => {
  const dueSortValue = task.dueAt ?? NO_DUE_DATE_SORT_VALUE;
  return {
    PK: `TASK#${task.id}`,
    SK: 'META',
    entityType: 'TASK',
    ...task,
    idempotencyPayloadHash,
    GSI1PK: `GROUP#${task.groupId}`,
    GSI1SK: `STATUS#${task.status}#DUE#${dueSortValue}#TASK#${task.id}`,
    GSI2PK: `USER#${task.assigneeId}`,
    GSI2SK: `DUE#${dueSortValue}#TASK#${task.id}`,
    ...(task.sourceMeetingId
      ? {
          GSI3PK: `MEETING#${task.sourceMeetingId}`,
          GSI3SK: `TASK#${task.createdAt}#${task.id}`,
        }
      : {}),
  };
};

const toGroupTask = (item: DynamoItem, expectedGroupId: string): Task => {
  const task = toTask(item);
  const status = stringValue(item, 'status');
  const dueAt = stringValue(item, 'dueAt');
  const dueSortValue = dueAt ?? NO_DUE_DATE_SORT_VALUE;
  const input = taskInputSchema.safeParse({
    groupId: item.groupId,
    title: item.title,
    assigneeId: item.assigneeId,
    priority: item.priority,
    ...(dueAt ? { dueAt } : {}),
    ...(stringValue(item, 'sourceMeetingId')
      ? { sourceMeetingId: stringValue(item, 'sourceMeetingId') }
      : {}),
  });

  if (
    !task ||
    !input.success ||
    item.entityType !== 'TASK' ||
    item.SK !== 'META' ||
    item.PK !== `TASK#${task.id}` ||
    item.groupId !== expectedGroupId ||
    item.GSI1PK !== `GROUP#${expectedGroupId}` ||
    item.GSI1SK !== `STATUS#${status}#DUE#${dueSortValue}#TASK#${task.id}` ||
    !Object.values(TaskStatus).includes(status as TaskStatus)
  ) {
    throw new Error('GROUP_PROGRESS_TASK_DATA_INTEGRITY');
  }

  return task;
};

export class DynamoDbGroupTaskReader implements GroupTaskReader {
  constructor(
    private readonly database: DynamoDBDocumentClient = documentClient,
    private readonly taskTable: string = tableName('TASK_DATA_TABLE'),
  ) {}

  async listByGroup(groupId: string): Promise<Task[]> {
    const tasks: Task[] = [];
    let exclusiveStartKey: Record<string, unknown> | undefined;

    do {
      const page = await this.database.send(
        new QueryCommand({
          TableName: this.taskTable,
          IndexName: 'GSI1',
          KeyConditionExpression: 'GSI1PK = :group',
          ExpressionAttributeValues: { ':group': `GROUP#${groupId}` },
          ExclusiveStartKey: exclusiveStartKey,
        }),
      );
      tasks.push(...(page.Items ?? []).map((item) => toGroupTask(item, groupId)));
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

export class DynamoDbTaskRepository implements TaskRepository {
  private async getItem(id: string): Promise<DynamoItem | undefined> {
    const result = await documentClient.send(
      new GetCommand({
        TableName: tableName('TASK_DATA_TABLE'),
        Key: { PK: `TASK#${id}`, SK: 'META' },
        ConsistentRead: true,
      }),
    );
    return result.Item;
  }

  async getById(id: string): Promise<Task | undefined> {
    const item = await this.getItem(id);
    return item ? toTask(item) : undefined;
  }

  async create(actorId: string, input: CreateTaskRequest, idempotencyKey: string): Promise<Task> {
    const id = taskIdFor(actorId, idempotencyKey);
    const idempotencyPayloadHash = payloadHashFor(input);
    const createdAt = new Date().toISOString();
    const task: PersistedTask = {
      id,
      groupId: input.groupId,
      title: input.title,
      assigneeId: input.assigneeId,
      status: TaskStatus.TODO,
      priority: input.priority,
      ...(input.dueAt ? { dueAt: input.dueAt } : {}),
      ...(input.sourceMeetingId ? { sourceMeetingId: input.sourceMeetingId } : {}),
      createdBy: actorId,
      createdAt,
      updatedAt: createdAt,
      version: 1,
    };

    try {
      await documentClient.send(
        new PutCommand({
          TableName: tableName('TASK_DATA_TABLE'),
          Item: taskItem(task, idempotencyPayloadHash),
          ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
        }),
      );
      return task;
    } catch (error) {
      if ((error as { name?: string }).name !== 'ConditionalCheckFailedException') throw error;
      const existingItem = await this.getItem(id);
      if (!existingItem) throw error;
      const existingTask = toTask(existingItem);
      const existingCreatedBy = stringValue(existingItem, 'createdBy');
      const existingPayloadHash = stringValue(existingItem, 'idempotencyPayloadHash');
      if (
        existingTask &&
        existingCreatedBy === actorId &&
        existingPayloadHash === idempotencyPayloadHash
      ) {
        return existingTask;
      }
      throw new ConflictError('Idempotency-Key đã được dùng với dữ liệu task khác.');
    }
  }

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

  async updateStatus(
    task: Task,
    actorId: string,
    status: TaskStatus,
    expectedVersion: number,
    isLegacyVersion: boolean,
    completionNote?: string,
    completionEvidenceUrl?: string,
  ): Promise<Task> {
    const updatedAt = new Date().toISOString();
    const nextVersion = expectedVersion + 1;
    const dueSortValue = task.dueAt ?? NO_DUE_DATE_SORT_VALUE;
    const eventId = randomUUID();
    const isCompleting = status === TaskStatus.DONE;
    const isReopening = task.status === TaskStatus.DONE && status === TaskStatus.DOING;
    if (isCompleting && !completionNote) throw new Error('TASK_COMPLETION_NOTE_REQUIRED');
    const updateExpression = isCompleting
      ? 'SET #status = :status, updatedAt = :updatedAt, #version = :nextVersion, GSI1SK = :gsi1sk, completedAt = :completedAt, completionNote = :completionNote' +
        (completionEvidenceUrl
          ? ', completionEvidenceUrl = :completionEvidenceUrl'
          : ' REMOVE completionEvidenceUrl')
      : isReopening
        ? 'SET #status = :status, updatedAt = :updatedAt, #version = :nextVersion, GSI1SK = :gsi1sk REMOVE completedAt'
        : 'SET #status = :status, updatedAt = :updatedAt, #version = :nextVersion, GSI1SK = :gsi1sk';
    const versionCondition = isLegacyVersion
      ? 'attribute_not_exists(#version)'
      : '#version = :expectedVersion';

    try {
      await documentClient.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Update: {
                TableName: tableName('TASK_DATA_TABLE'),
                Key: { PK: `TASK#${task.id}`, SK: 'META' },
                UpdateExpression: updateExpression,
                ConditionExpression: `attribute_exists(PK) AND ${versionCondition} AND #status = :fromStatus`,
                ExpressionAttributeNames: { '#status': 'status', '#version': 'version' },
                ExpressionAttributeValues: {
                  ':status': status,
                  ':fromStatus': task.status,
                  ':updatedAt': updatedAt,
                  ':nextVersion': nextVersion,
                  ':gsi1sk': `STATUS#${status}#DUE#${dueSortValue}#TASK#${task.id}`,
                  ...(isLegacyVersion ? {} : { ':expectedVersion': expectedVersion }),
                  ...(isCompleting
                    ? {
                        ':completedAt': updatedAt,
                        ':completionNote': completionNote,
                        ...(completionEvidenceUrl
                          ? { ':completionEvidenceUrl': completionEvidenceUrl }
                          : {}),
                      }
                    : {}),
                },
              },
            },
            {
              Put: {
                TableName: tableName('TASK_DATA_TABLE'),
                Item: {
                  PK: `TASK#${task.id}`,
                  SK: `EVENT#${updatedAt}#${eventId}`,
                  entityType: 'TASK_EVENT',
                  eventType: 'STATUS_CHANGED',
                  taskId: task.id,
                  groupId: task.groupId,
                  actorId,
                  fromStatus: task.status,
                  toStatus: status,
                  createdAt: updatedAt,
                  version: nextVersion,
                  ...(isCompleting
                    ? {
                        completionNote,
                        ...(completionEvidenceUrl ? { completionEvidenceUrl } : {}),
                      }
                    : {}),
                },
                ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
              },
            },
          ],
        }),
      );
    } catch (error) {
      if ((error as { name?: string }).name !== 'TransactionCanceledException') throw error;
      const current = await this.getById(task.id);
      if (!current) throw new ResourceNotFoundError('Không tìm thấy công việc.');
      const currentIsLegacyVersion = current.version === undefined;
      if (
        (current.version !== undefined && current.version < 1) ||
        currentIsLegacyVersion !== isLegacyVersion ||
        (current.version !== undefined && current.version !== expectedVersion) ||
        current.status !== task.status
      ) {
        throw new ConflictError('Công việc đã được cập nhật bởi yêu cầu khác.');
      }
      throw error;
    }

    const updatedTask: Task = {
      ...task,
      status,
      updatedAt,
      version: nextVersion,
      ...(isCompleting ? { completedAt: updatedAt } : {}),
      ...(isCompleting ? { completionNote } : {}),
      ...(isCompleting && completionEvidenceUrl ? { completionEvidenceUrl } : {}),
    };
    if (isCompleting && !completionEvidenceUrl) delete updatedTask.completionEvidenceUrl;
    if (isReopening) delete updatedTask.completedAt;
    return updatedTask;
  }
}
