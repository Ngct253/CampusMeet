import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { KnowledgeSource } from '@campusmeet/shared';
import { describe, expect, it, vi } from 'vitest';
import { DynamoKnowledgeSourceRepository } from '../src/repositories/dynamodb';

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
});
