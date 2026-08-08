import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { createHash } from 'node:crypto';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { Priority } from '@campusmeet/shared';
import { describe, expect, it, vi } from 'vitest';
import { createTaskProposalConfirmationHandler } from '../src/handlers/task-proposals';
import { DynamoDbTaskProposalConfirmationRepository } from '../src/repositories/task-proposals';
import { apiEvent } from './fixtures';

const citation = {
  citationId: 'citation-1',
  groupId: 'group-1',
  meetingId: 'meeting-1',
  sourceType: 'TRANSCRIPT' as const,
  sourceId: 'transcript-1',
  sourceVersion: 1,
  internalUri: 'campusmeet://meetings/meeting-1/transcripts/transcript-1',
};
const proposalItem = {
  PK: 'PROPOSAL#proposal-1',
  SK: 'META',
  entityType: 'TaskProposal',
  proposalId: 'proposal-1',
  groupId: 'group-1',
  meetingId: 'meeting-1',
  title: 'Proposal title',
  assigneeId: 'member-1',
  priority: 'MEDIUM',
  missingFields: [],
  citations: [citation],
  status: 'PENDING',
  actorId: 'requester-1',
  createdAt: '2026-08-08T00:00:00.000Z',
  GSI1PK: 'USER#requester-1',
  GSI1SK: 'PROPOSAL#PENDING#proposal-1',
};
const confirmedTaskId = createHash('sha256')
  .update(JSON.stringify(['TASK_PROPOSAL_CONFIRMATION', 'proposal-1']))
  .digest('hex')
  .slice(0, 32);

describe('DynamoDbTaskProposalConfirmationRepository', () => {
  it('strongly reads and validates the persisted proposal envelope', async () => {
    const send = vi.fn().mockResolvedValue({ Item: proposalItem });
    const repository = new DynamoDbTaskProposalConfirmationRepository(
      { send } as unknown as DynamoDBDocumentClient,
      'ai-work',
      'task-data',
    );

    await expect(repository.getById('proposal-1')).resolves.toMatchObject({
      proposalId: 'proposal-1',
      status: 'PENDING',
    });
    expect(send.mock.calls[0]![0].input).toEqual({
      TableName: 'ai-work',
      Key: { PK: 'PROPOSAL#proposal-1', SK: 'META' },
      ConsistentRead: true,
    });
  });

  it.each([
    ['PK', { PK: 'PROPOSAL#other' }],
    ['SK', { SK: 'OTHER' }],
    ['entity type', { entityType: 'Other' }],
    ['proposal id', { proposalId: 'other' }],
    ['group', { groupId: '' }],
    ['meeting', { meetingId: '' }],
    ['status index', { GSI1SK: 'PROPOSAL#CONFIRMED#proposal-1' }],
    ['created timestamp', { createdAt: 'not-a-date' }],
  ])('rejects malformed persisted proposal %s', async (_label, override) => {
    const send = vi.fn().mockResolvedValue({ Item: { ...proposalItem, ...override } });
    const repository = new DynamoDbTaskProposalConfirmationRepository(
      { send } as unknown as DynamoDBDocumentClient,
      'ai-work',
      'task-data',
    );
    await expect(repository.getById('proposal-1')).rejects.toThrow('TASK_PROPOSAL_DATA_INTEGRITY');
  });

  it('atomically creates a valid Task and confirms the PENDING proposal', async () => {
    const send = vi.fn().mockResolvedValue({});
    const repository = new DynamoDbTaskProposalConfirmationRepository(
      { send } as unknown as DynamoDBDocumentClient,
      'ai-work',
      'task-data',
      () => new Date('2026-08-09T00:00:00.000Z'),
    );

    const result = await repository.confirm({
      actorId: 'admin-1',
      proposal: {
        proposalId: 'proposal-1',
        groupId: 'group-1',
        meetingId: 'meeting-1',
        title: 'Proposal title',
        missingFields: ['assigneeId', 'priority'],
        citations: [citation],
        status: 'PENDING',
      },
      input: {
        title: 'Final title',
        assigneeId: 'member-1',
        priority: Priority.HIGH,
        dueAt: '2026-08-20T00:00:00.000Z',
      },
    });

    const command = send.mock.calls[0]![0];
    expect(command.constructor.name).toBe('TransactWriteCommand');
    expect(command.input.TransactItems).toHaveLength(2);
    const [taskWrite, proposalWrite] = command.input.TransactItems;
    expect(taskWrite.Put).toMatchObject({
      TableName: 'task-data',
      ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
      Item: {
        PK: expect.stringMatching(/^TASK#/),
        SK: 'META',
        entityType: 'TASK',
        groupId: 'group-1',
        title: 'Final title',
        assigneeId: 'member-1',
        status: 'TODO',
        priority: 'HIGH',
        dueAt: '2026-08-20T00:00:00.000Z',
        sourceMeetingId: 'meeting-1',
        createdBy: 'admin-1',
        createdAt: '2026-08-09T00:00:00.000Z',
        updatedAt: '2026-08-09T00:00:00.000Z',
        version: 1,
        GSI1PK: 'GROUP#group-1',
        GSI1SK: `STATUS#TODO#DUE#2026-08-20T00:00:00.000Z#TASK#${result.task.id}`,
        GSI2PK: 'USER#member-1',
        GSI2SK: `DUE#2026-08-20T00:00:00.000Z#TASK#${result.task.id}`,
        GSI3PK: 'MEETING#meeting-1',
        GSI3SK: `TASK#2026-08-09T00:00:00.000Z#${result.task.id}`,
      },
    });
    expect(proposalWrite.Update).toMatchObject({
      TableName: 'ai-work',
      Key: { PK: 'PROPOSAL#proposal-1', SK: 'META' },
      ConditionExpression: expect.stringContaining('#status = :pending'),
      ExpressionAttributeValues: expect.objectContaining({
        ':pending': 'PENDING',
        ':confirmed': 'CONFIRMED',
        ':taskId': result.task.id,
        ':actorId': 'admin-1',
      }),
    });
    expect(result).toMatchObject({
      task: { id: result.task.id, status: 'TODO', version: 1 },
      proposal: { status: 'CONFIRMED', confirmedTaskId: result.task.id },
    });
  });

  it('uses the no-due sentinel only in Task indexes and removes stale proposal dueAt', async () => {
    const send = vi.fn().mockResolvedValue({});
    const repository = new DynamoDbTaskProposalConfirmationRepository(
      { send } as unknown as DynamoDBDocumentClient,
      'ai-work',
      'task-data',
      () => new Date('2026-08-09T00:00:00.000Z'),
    );

    const result = await repository.confirm({
      actorId: 'admin-1',
      proposal: {
        proposalId: 'proposal-1',
        groupId: 'group-1',
        meetingId: 'meeting-1',
        title: 'Proposal title',
        assigneeId: 'member-1',
        priority: 'MEDIUM',
        missingFields: [],
        citations: [citation],
        status: 'PENDING',
      },
      input: {
        title: 'Final title',
        assigneeId: 'member-1',
        priority: Priority.MEDIUM,
      },
    });

    const [taskWrite, proposalWrite] = send.mock.calls[0]![0].input.TransactItems;
    expect(taskWrite.Put.Item).toMatchObject({
      GSI1SK: `STATUS#TODO#DUE#9999-12-31T23:59:59.999Z#TASK#${result.task.id}`,
      GSI2SK: `DUE#9999-12-31T23:59:59.999Z#TASK#${result.task.id}`,
    });
    expect(taskWrite.Put.Item).not.toHaveProperty('dueAt');
    expect(proposalWrite.Update.UpdateExpression).toContain('REMOVE dueAt');
    expect(result.task).not.toHaveProperty('dueAt');
  });

  it('recovers concurrent confirmation as the same authoritative Task', async () => {
    const cancelled = Object.assign(new Error('cancelled'), {
      name: 'TransactionCanceledException',
    });
    const confirmedProposal = {
      ...proposalItem,
      title: 'Winner title',
      status: 'CONFIRMED',
      confirmedTaskId,
      confirmedBy: 'other-admin',
      confirmedAt: '2026-08-09T00:00:00.000Z',
      GSI1SK: 'PROPOSAL#CONFIRMED#proposal-1',
    };
    const task = {
      PK: `TASK#${confirmedTaskId}`,
      SK: 'META',
      entityType: 'TASK',
      id: confirmedTaskId,
      groupId: 'group-1',
      title: 'Winner title',
      assigneeId: 'member-1',
      status: 'TODO',
      priority: 'MEDIUM',
      sourceMeetingId: 'meeting-1',
      createdBy: 'other-admin',
      createdAt: '2026-08-09T00:00:00.000Z',
      updatedAt: '2026-08-09T00:00:00.000Z',
      version: 1,
      GSI1PK: 'GROUP#group-1',
      GSI1SK: `STATUS#TODO#DUE#9999-12-31T23:59:59.999Z#TASK#${confirmedTaskId}`,
      GSI2PK: 'USER#member-1',
      GSI2SK: `DUE#9999-12-31T23:59:59.999Z#TASK#${confirmedTaskId}`,
      GSI3PK: 'MEETING#meeting-1',
      GSI3SK: `TASK#2026-08-09T00:00:00.000Z#${confirmedTaskId}`,
    };
    const send = vi
      .fn()
      .mockRejectedValueOnce(cancelled)
      .mockResolvedValueOnce({ Item: confirmedProposal })
      .mockResolvedValueOnce({ Item: task });
    const repository = new DynamoDbTaskProposalConfirmationRepository(
      { send } as unknown as DynamoDBDocumentClient,
      'ai-work',
      'task-data',
    );

    await expect(
      repository.confirm({
        actorId: 'admin-1',
        proposal: {
          proposalId: 'proposal-1',
          groupId: 'group-1',
          meetingId: 'meeting-1',
          title: 'Loser title',
          assigneeId: 'member-1',
          priority: 'MEDIUM',
          missingFields: [],
          citations: [citation],
          status: 'PENDING',
        },
        input: {
          title: 'Loser title',
          assigneeId: 'member-1',
          priority: Priority.MEDIUM,
        },
      }),
    ).resolves.toMatchObject({
      task: { id: confirmedTaskId, title: 'Winner title' },
      proposal: { confirmedTaskId },
    });
    expect(send).toHaveBeenCalledTimes(3);
  });

  it('rethrows transaction failures that are not proven confirmation races', async () => {
    const denied = Object.assign(new Error('denied'), { name: 'AccessDeniedException' });
    const send = vi.fn().mockRejectedValue(denied);
    const repository = new DynamoDbTaskProposalConfirmationRepository(
      { send } as unknown as DynamoDBDocumentClient,
      'ai-work',
      'task-data',
    );
    await expect(
      repository.confirm({
        actorId: 'admin-1',
        proposal: {
          proposalId: 'proposal-1',
          groupId: 'group-1',
          meetingId: 'meeting-1',
          title: 'Title',
          assigneeId: 'member-1',
          priority: 'HIGH',
          missingFields: [],
          citations: [citation],
          status: 'PENDING',
        },
        input: { title: 'Title', assigneeId: 'member-1', priority: Priority.HIGH },
      }),
    ).rejects.toBe(denied);
    expect(send).toHaveBeenCalledOnce();
  });
});

describe('task proposal confirmation handler', () => {
  const event = () => {
    const value = apiEvent('/ai/task-proposals/proposal-1/confirm');
    value.requestContext.http.method = 'POST';
    value.pathParameters = { proposalId: 'proposal-1' };
    value.body = JSON.stringify({ assigneeId: 'member-1', priority: 'HIGH' });
    (
      value.requestContext as typeof value.requestContext & {
        authorizer: { jwt: { claims: Record<string, unknown>; scopes: string[] } };
      }
    ).authorizer = { jwt: { claims: { sub: 'admin-1' }, scopes: [] } };
    return value;
  };

  it('uses the JWT actor and path proposal id in the standard envelope', async () => {
    const service = {
      confirm: vi.fn().mockResolvedValue({ task: { id: 'task-1' }, proposal: {} }),
    };
    const response = (await createTaskProposalConfirmationHandler(service)(
      event(),
      {} as never,
      vi.fn(),
    )) as APIGatewayProxyStructuredResultV2;
    expect(response.statusCode).toBe(200);
    expect(service.confirm).toHaveBeenCalledWith('admin-1', 'proposal-1', {
      assigneeId: 'member-1',
      priority: 'HIGH',
    });
    expect(JSON.parse(response.body ?? '{}')).toMatchObject({
      success: true,
      data: { task: { id: 'task-1' } },
      requestId: 'test-request-id',
    });
  });

  it('returns 401 without JWT and 400 for forbidden client fields', async () => {
    const service = { confirm: vi.fn() };
    const missingJwt = event();
    delete (missingJwt.requestContext as { authorizer?: unknown }).authorizer;
    const unauthorized = (await createTaskProposalConfirmationHandler(service)(
      missingJwt,
      {} as never,
      vi.fn(),
    )) as APIGatewayProxyStructuredResultV2;
    expect(unauthorized.statusCode).toBe(401);

    const forged = event();
    forged.body = JSON.stringify({ taskId: 'forged' });
    const invalid = (await createTaskProposalConfirmationHandler(service)(
      forged,
      {} as never,
      vi.fn(),
    )) as APIGatewayProxyStructuredResultV2;
    expect(invalid.statusCode).toBe(400);
    expect(service.confirm).not.toHaveBeenCalled();
  });
});
