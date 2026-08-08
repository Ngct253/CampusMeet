import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { KnowledgeSource } from '@campusmeet/shared';
import { describe, expect, it, vi } from 'vitest';
import {
  DynamoAIJobRepository,
  DynamoGroupProgressSnapshotReader,
  DynamoKnowledgeSourceRepository,
} from '../src/repositories/dynamodb';

const source: KnowledgeSource = {
  sourceId: 'source-1',
  groupId: 'group-1',
  meetingId: 'meeting-1',
  sourceType: 'ATTACHMENT',
  version: 2,
  approved: true,
  ingestionStatus: 'PROCESSING',
  normalizedObjectKey: 'kb/group-1/meeting-1/source-1/v2/content.txt',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

describe('DynamoAIJobRepository', () => {
  it('stores input and output token usage when completing a generation job', async () => {
    const send = vi.fn().mockResolvedValue({});
    const repository = new DynamoAIJobRepository(
      { send } as unknown as DynamoDBDocumentClient,
      'ai-work',
    );

    await repository.markCompleted(
      'job-1',
      { answer: 'ok' },
      {
        inputTokens: 120,
        outputTokens: 30,
      },
    );

    expect(send.mock.calls[0]![0].input).toMatchObject({
      UpdateExpression: expect.stringContaining('inputTokens = :inputTokens'),
      ExpressionAttributeValues: expect.objectContaining({
        ':inputTokens': 120,
        ':outputTokens': 30,
      }),
    });
  });
});

describe('DynamoKnowledgeSourceRepository', () => {
  it('stores the documented source/version key and group index', async () => {
    const send = vi.fn().mockResolvedValue({});
    const repository = new DynamoKnowledgeSourceRepository(
      { send } as unknown as DynamoDBDocumentClient,
      'ai-work',
    );

    await repository.saveVersion(source);

    expect(send.mock.calls[0]![0].input).toMatchObject({
      TableName: 'ai-work',
      Item: {
        PK: 'SOURCE#source-1',
        SK: 'VERSION#0000000002',
        GSI1PK: 'GROUP#group-1',
      },
      ConditionExpression: 'attribute_not_exists(PK)',
    });
  });

  it('makes an identical retry idempotent by returning the existing version', async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error('ConditionalCheckFailedException'))
      .mockResolvedValueOnce({
        Item: {
          PK: 'SOURCE#source-1',
          SK: 'VERSION#0000000002',
          ...source,
          ingestionStatus: 'READY',
          updatedAt: '2026-08-01T00:10:00.000Z',
        },
      });
    const repository = new DynamoKnowledgeSourceRepository(
      { send } as unknown as DynamoDBDocumentClient,
      'ai-work',
    );

    await expect(repository.saveVersion(source)).resolves.toMatchObject({
      ...source,
      ingestionStatus: 'READY',
      updatedAt: '2026-08-01T00:10:00.000Z',
    });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('does not accept a conflicting retry for the same source version', async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error('ConditionalCheckFailedException'))
      .mockResolvedValueOnce({
        Item: {
          PK: 'SOURCE#source-1',
          SK: 'VERSION#0000000002',
          ...source,
          normalizedObjectKey: 'kb/conflicting.txt',
        },
      });
    const repository = new DynamoKnowledgeSourceRepository(
      { send } as unknown as DynamoDBDocumentClient,
      'ai-work',
    );

    await expect(repository.saveVersion(source)).rejects.toThrow('ConditionalCheckFailedException');
  });

  it('marks old versions stale, gives them a TTL, and returns normalized keys for cleanup', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({
        Items: [
          {
            PK: 'SOURCE#source-1',
            SK: 'VERSION#0000000001',
            normalizedObjectKey: 'kb/group-1/meeting-1/source-1/v1/content.txt',
          },
        ],
      })
      .mockResolvedValueOnce({});
    const repository = new DynamoKnowledgeSourceRepository(
      { send } as unknown as DynamoDBDocumentClient,
      'ai-work',
    );

    await expect(repository.markOlderVersionsStale('source-1', 2)).resolves.toEqual([
      'kb/group-1/meeting-1/source-1/v1/content.txt',
    ]);

    expect(send.mock.calls[1]![0].input).toMatchObject({
      UpdateExpression: 'SET ingestionStatus = :stale, updatedAt = :now, expiresAtEpoch = :expires',
      ExpressionAttributeValues: expect.objectContaining({
        ':stale': 'STALE',
        ':expires': expect.any(Number),
      }),
    });
  });
});

describe('DynamoGroupProgressSnapshotReader', () => {
  const persistedSnapshot = {
    PK: 'GROUP#group-1',
    SK: 'PROGRESS_SNAPSHOT#VERSION#0000000004',
    entityType: 'GROUP_PROGRESS_SNAPSHOT',
    recordType: 'VERSION',
    generationId: 'generation-4',
    groupId: 'group-1',
    version: 4,
    generatedAt: '2026-08-08T10:00:00.000Z',
    taskCounts: { total: 3, todo: 1, doing: 1, done: 1, overdue: 1 },
    meetingCounts: { completed: 2, upcoming: 1 },
  };

  it('constructs the exact immutable key for snapshot version one', async () => {
    const send = vi.fn().mockResolvedValue({
      Item: {
        ...persistedSnapshot,
        SK: 'PROGRESS_SNAPSHOT#VERSION#0000000001',
        version: 1,
      },
    });
    const reader = new DynamoGroupProgressSnapshotReader(
      { send } as unknown as DynamoDBDocumentClient,
      'task-data',
    );

    await expect(reader.get('group-1', 1)).resolves.toMatchObject({ version: 1 });
    expect(send.mock.calls[0]![0].input.Key).toEqual({
      PK: 'GROUP#group-1',
      SK: 'PROGRESS_SNAPSHOT#VERSION#0000000001',
    });
  });

  it('strongly reads only the exact immutable version key', async () => {
    const send = vi.fn().mockResolvedValue({ Item: persistedSnapshot });
    const reader = new DynamoGroupProgressSnapshotReader(
      { send } as unknown as DynamoDBDocumentClient,
      'task-data',
    );

    await expect(reader.get('group-1', 4)).resolves.toEqual({
      groupId: 'group-1',
      version: 4,
      generatedAt: '2026-08-08T10:00:00.000Z',
      taskCounts: { total: 3, todo: 1, doing: 1, done: 1, overdue: 1 },
      meetingCounts: { completed: 2, upcoming: 1 },
    });
    expect(send.mock.calls[0]![0].input).toEqual({
      TableName: 'task-data',
      Key: {
        PK: 'GROUP#group-1',
        SK: 'PROGRESS_SNAPSHOT#VERSION#0000000004',
      },
      ConsistentRead: true,
    });
  });

  it.each([
    ['group mismatch', { groupId: 'group-2' }],
    ['version mismatch', { version: 5 }],
    ['wrong key', { SK: 'PROGRESS_SNAPSHOT#LATEST' }],
    ['wrong entity', { entityType: 'TASK' }],
    ['wrong record type', { recordType: 'LATEST' }],
    ['missing generationId', { generationId: undefined }],
    ['invalid domain', { taskCounts: { ...persistedSnapshot.taskCounts, total: 9 } }],
  ])('rejects %s without falling back to LATEST', async (_label, override) => {
    const send = vi.fn().mockResolvedValue({ Item: { ...persistedSnapshot, ...override } });
    const reader = new DynamoGroupProgressSnapshotReader(
      { send } as unknown as DynamoDBDocumentClient,
      'task-data',
    );

    await expect(reader.get('group-1', 4)).rejects.toThrow(
      'GROUP_PROGRESS_SNAPSHOT_DATA_INTEGRITY',
    );
    expect(send).toHaveBeenCalledOnce();
  });

  it('fails when the exact version does not exist', async () => {
    const send = vi.fn().mockResolvedValue({});
    const reader = new DynamoGroupProgressSnapshotReader(
      { send } as unknown as DynamoDBDocumentClient,
      'task-data',
    );

    await expect(reader.get('group-1', 4)).rejects.toThrow('GROUP_PROGRESS_SNAPSHOT_NOT_FOUND');
  });
});
