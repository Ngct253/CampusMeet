import { beforeEach, describe, expect, it, vi } from 'vitest';

const send = vi.hoisted(() => vi.fn());
vi.mock('../src/repositories/client', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/repositories/client')>();
  return { ...original, documentClient: { send } };
});

import { DynamoDbTaskProposalConfirmationRepository } from '../src/repositories/task-proposals';

const citation = {
  citationId: 'citation-1',
  groupId: 'group-1',
  meetingId: 'meeting-1',
  sourceType: 'TRANSCRIPT',
  sourceId: 'transcript-1',
  sourceVersion: 1,
  internalUri: 'campusmeet://meetings/meeting-1/transcripts/transcript-1',
};

const proposalItem = {
  PK: 'PROPOSAL#proposal-1',
  SK: 'META',
  proposalId: 'proposal-1',
  groupId: 'group-1',
  meetingId: 'meeting-1',
  title: 'Hoàn thiện bản demo',
  missingFields: ['assigneeId', 'priority'],
  citations: [citation],
};

describe('DynamoDbTaskProposalConfirmationRepository', () => {
  beforeEach(() => {
    send.mockReset();
    process.env.AI_WORK_TABLE = 'campusmeet-test-ai-work';
  });

  it('claims only a pending proposal or an exact retry by the same actor and key', async () => {
    send.mockResolvedValueOnce({ Attributes: { ...proposalItem, status: 'CONFIRMED' } });

    await new DynamoDbTaskProposalConfirmationRepository().claim(
      'proposal-1',
      'admin-1',
      'confirm-key',
    );

    const command = send.mock.calls[0]?.[0] as {
      constructor: { name: string };
      input: {
        TableName: string;
        ConditionExpression: string;
        ExpressionAttributeValues: Record<string, unknown>;
      };
    };
    expect(command.constructor.name).toBe('UpdateCommand');
    expect(command.input).toMatchObject({
      TableName: 'campusmeet-test-ai-work',
      ConditionExpression:
        '#status = :pending OR (#status = :confirmed AND confirmedBy = :actor AND confirmationKey = :key)',
      ExpressionAttributeValues: {
        ':pending': 'PENDING',
        ':confirmed': 'CONFIRMED',
        ':actor': 'admin-1',
        ':key': 'confirm-key',
      },
    });
  });

  it('links the task only for the actor and key that claimed the proposal', async () => {
    send.mockResolvedValueOnce({
      Attributes: { ...proposalItem, status: 'EXECUTED', taskId: 'task-1' },
    });

    const result = await new DynamoDbTaskProposalConfirmationRepository().markExecuted(
      'proposal-1',
      'admin-1',
      'confirm-key',
      'task-1',
    );

    const command = send.mock.calls[0]?.[0] as {
      input: {
        ConditionExpression: string;
        ExpressionAttributeValues: Record<string, unknown>;
      };
    };
    expect(command.input).toMatchObject({
      ConditionExpression:
        '#status = :confirmed AND confirmedBy = :actor AND confirmationKey = :key',
      ExpressionAttributeValues: {
        ':confirmed': 'CONFIRMED',
        ':executed': 'EXECUTED',
        ':actor': 'admin-1',
        ':key': 'confirm-key',
        ':taskId': 'task-1',
      },
    });
    expect(result).toMatchObject({ status: 'EXECUTED', taskId: 'task-1' });
  });

  it('maps a concurrent claim to the standard conflict response', async () => {
    send.mockRejectedValueOnce(
      Object.assign(new Error('conditional'), { name: 'ConditionalCheckFailedException' }),
    );

    await expect(
      new DynamoDbTaskProposalConfirmationRepository().claim(
        'proposal-1',
        'admin-2',
        'other-key',
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT', statusCode: 409 });
  });
});
