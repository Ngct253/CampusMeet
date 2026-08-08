import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { Priority, TaskStatus, type GroupProgressSnapshot } from '@campusmeet/shared';
import { describe, expect, it, vi } from 'vitest';
import {
  DynamoDbGroupProgressSnapshotRepository,
  SnapshotPublishConflictError,
} from '../src/repositories/group-progress-snapshots';
import { DynamoDbGroupTaskReader } from '../src/repositories/tasks';

const snapshot: GroupProgressSnapshot = {
  groupId: 'group-1',
  version: 2,
  generatedAt: '2026-08-08T10:00:00.000Z',
  taskCounts: { total: 3, todo: 1, doing: 1, done: 1, overdue: 1 },
  meetingCounts: { completed: 2, upcoming: 1 },
};
const versionItem = {
  PK: 'GROUP#group-1',
  SK: 'PROGRESS_SNAPSHOT#VERSION#0000000002',
  entityType: 'GROUP_PROGRESS_SNAPSHOT',
  recordType: 'VERSION',
  generationId: 'generation-2',
  ...snapshot,
};
const latestItem = { ...versionItem, SK: 'PROGRESS_SNAPSHOT#LATEST', recordType: 'LATEST' };
const taskItem = {
  PK: 'TASK#task-1',
  SK: 'META',
  entityType: 'TASK',
  id: 'task-1',
  groupId: 'group-1',
  title: 'Task',
  assigneeId: 'user-1',
  status: TaskStatus.TODO,
  priority: Priority.MEDIUM,
  dueAt: '2026-08-09T00:00:00.000Z',
  GSI1PK: 'GROUP#group-1',
  GSI1SK: 'STATUS#TODO#DUE#2026-08-09T00:00:00.000Z#TASK#task-1',
};

describe('DynamoDbGroupProgressSnapshotRepository', () => {
  it('strongly reads exact padded VERSION and strips persistence metadata', async () => {
    const send = vi.fn().mockResolvedValue({ Item: versionItem });
    const repository = new DynamoDbGroupProgressSnapshotRepository(
      { send } as unknown as DynamoDBDocumentClient,
      'task-data',
    );

    await expect(repository.getVersion('group-1', 2)).resolves.toEqual(snapshot);
    expect(send.mock.calls[0]![0].input).toEqual({
      TableName: 'task-data',
      Key: {
        PK: 'GROUP#group-1',
        SK: 'PROGRESS_SNAPSHOT#VERSION#0000000002',
      },
      ConsistentRead: true,
    });
  });

  it('strongly reads the full LATEST record', async () => {
    const send = vi.fn().mockResolvedValue({ Item: latestItem });
    const repository = new DynamoDbGroupProgressSnapshotRepository(
      { send } as unknown as DynamoDBDocumentClient,
      'task-data',
    );

    await expect(repository.getLatest('group-1')).resolves.toEqual(snapshot);
    expect(send.mock.calls[0]![0].input).toMatchObject({
      Key: { PK: 'GROUP#group-1', SK: 'PROGRESS_SNAPSHOT#LATEST' },
      ConsistentRead: true,
    });
  });

  it('atomically publishes exactly immutable VERSION and full LATEST with one generationId', async () => {
    const send = vi.fn().mockResolvedValue({});
    const repository = new DynamoDbGroupProgressSnapshotRepository(
      { send } as unknown as DynamoDBDocumentClient,
      'task-data',
    );

    await repository.publish(snapshot, 1, 'generation-2');

    const input = send.mock.calls[0]![0].input;
    expect(input.TransactItems).toHaveLength(2);
    expect(input.TransactItems[0].Put).toMatchObject({
      TableName: 'task-data',
      Item: {
        ...snapshot,
        SK: 'PROGRESS_SNAPSHOT#VERSION#0000000002',
        recordType: 'VERSION',
        generationId: 'generation-2',
      },
      ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
    });
    expect(input.TransactItems[1].Put).toMatchObject({
      Item: {
        ...snapshot,
        SK: 'PROGRESS_SNAPSHOT#LATEST',
        recordType: 'LATEST',
        generationId: 'generation-2',
      },
      ConditionExpression: expect.stringContaining('#version = :expectedPreviousVersion'),
      ExpressionAttributeValues: expect.objectContaining({ ':expectedPreviousVersion': 1 }),
    });
  });

  it('requires LATEST to be absent when publishing the first version', async () => {
    const send = vi.fn().mockResolvedValue({});
    const repository = new DynamoDbGroupProgressSnapshotRepository(
      { send } as unknown as DynamoDBDocumentClient,
      'task-data',
    );

    await repository.publish({ ...snapshot, version: 1 }, 0, 'generation-1');

    expect(send.mock.calls[0]![0].input.TransactItems[1].Put.ConditionExpression).toBe(
      'attribute_not_exists(PK) AND attribute_not_exists(SK)',
    );
  });

  it.each([
    ['wrong PK', { PK: 'GROUP#group-2' }],
    ['wrong group', { groupId: 'group-2' }],
    ['wrong entity', { entityType: 'TASK' }],
    ['wrong record type', { recordType: 'LATEST' }],
    ['wrong version', { version: 3 }],
    ['wrong encoded SK', { SK: 'PROGRESS_SNAPSHOT#VERSION#0000000003' }],
    ['missing generation', { generationId: undefined }],
    ['malformed domain', { taskCounts: { ...snapshot.taskCounts, total: -1 } }],
  ])('rejects %s in a persisted VERSION envelope', async (_label, override) => {
    const send = vi.fn().mockResolvedValue({ Item: { ...versionItem, ...override } });
    const repository = new DynamoDbGroupProgressSnapshotRepository(
      { send } as unknown as DynamoDBDocumentClient,
      'task-data',
    );

    await expect(repository.getVersion('group-1', 2)).rejects.toThrow(
      'GROUP_PROGRESS_SNAPSHOT_DATA_INTEGRITY',
    );
  });

  it('maps only a confirmed concurrent latest change to publish conflict', async () => {
    const cancellation = Object.assign(new Error('cancelled'), {
      name: 'TransactionCanceledException',
    });
    const send = vi
      .fn()
      .mockRejectedValueOnce(cancellation)
      .mockResolvedValueOnce({ Item: { ...latestItem, version: 3 } });
    const repository = new DynamoDbGroupProgressSnapshotRepository(
      { send } as unknown as DynamoDBDocumentClient,
      'task-data',
    );

    await expect(repository.publish(snapshot, 1, 'generation-2')).rejects.toBeInstanceOf(
      SnapshotPublishConflictError,
    );
  });

  it('does not disguise an unrelated transaction cancellation as contention', async () => {
    const cancellation = Object.assign(new Error('cancelled'), {
      name: 'TransactionCanceledException',
    });
    const send = vi
      .fn()
      .mockRejectedValueOnce(cancellation)
      .mockResolvedValueOnce({ Item: { ...latestItem, version: 1 } })
      .mockResolvedValueOnce({});
    const repository = new DynamoDbGroupProgressSnapshotRepository(
      { send } as unknown as DynamoDBDocumentClient,
      'task-data',
    );

    await expect(repository.publish(snapshot, 1, 'generation-2')).rejects.toBe(cancellation);
  });
});

describe('DynamoDbGroupTaskReader', () => {
  it('queries every GSI1 page without using strong consistency', async () => {
    const cursor = { PK: 'TASK#task-1', SK: 'META', GSI1PK: 'GROUP#group-1' };
    const send = vi
      .fn()
      .mockResolvedValueOnce({ Items: [taskItem], LastEvaluatedKey: cursor })
      .mockResolvedValueOnce({
        Items: [
          {
            ...taskItem,
            id: 'task-2',
            PK: 'TASK#task-2',
            GSI1SK: 'STATUS#TODO#DUE#2026-08-09T00:00:00.000Z#TASK#task-2',
          },
        ],
      });
    const reader = new DynamoDbGroupTaskReader(
      { send } as unknown as DynamoDBDocumentClient,
      'task-data',
    );

    await expect(reader.listByGroup('group-1')).resolves.toHaveLength(2);
    expect(send.mock.calls[0]![0].input).toMatchObject({
      TableName: 'task-data',
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :group',
      ExpressionAttributeValues: { ':group': 'GROUP#group-1' },
    });
    expect(send.mock.calls[0]![0].input.ConsistentRead).toBeUndefined();
    expect(send.mock.calls[1]![0].input.ExclusiveStartKey).toEqual(cursor);
  });

  it('guards a repeated LastEvaluatedKey', async () => {
    const cursor = { PK: 'TASK#task-1', SK: 'META' };
    const send = vi
      .fn()
      .mockResolvedValueOnce({ Items: [taskItem], LastEvaluatedKey: cursor })
      .mockResolvedValueOnce({ Items: [], LastEvaluatedKey: cursor });
    const reader = new DynamoDbGroupTaskReader(
      { send } as unknown as DynamoDBDocumentClient,
      'task-data',
    );

    await expect(reader.listByGroup('group-1')).rejects.toThrow(
      'Task pagination cursor did not advance.',
    );
  });

  it('rejects malformed Task metadata instead of silently dropping it', async () => {
    const send = vi.fn().mockResolvedValue({ Items: [{ ...taskItem, entityType: 'TASK_EVENT' }] });
    const reader = new DynamoDbGroupTaskReader(
      { send } as unknown as DynamoDBDocumentClient,
      'task-data',
    );

    await expect(reader.listByGroup('group-1')).rejects.toThrow(
      'GROUP_PROGRESS_TASK_DATA_INTEGRITY',
    );
  });
});
