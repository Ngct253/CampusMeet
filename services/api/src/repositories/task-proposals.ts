import { createHash } from 'node:crypto';
import { GetCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { z } from 'zod';
import {
  TaskStatus,
  confirmTaskProposalResponseSchema,
  taskProposalSchema,
  type ConfirmTaskProposalResponse,
  type Task,
  type TaskProposal,
} from '@campusmeet/shared';
import type {
  TaskProposalConfirmationRepository,
  TaskProposalConfirmationWrite,
} from '../domain/ports';
import { ConflictError } from '../utils/errors';
import { documentClient, stringValue, tableName, type DynamoItem } from './client';

const NO_DUE_DATE_SORT_VALUE = '9999-12-31T23:59:59.999Z';
const persistedTimestampSchema = z.string().datetime({ offset: true });

const taskIdFor = (proposalId: string) =>
  createHash('sha256')
    .update(JSON.stringify(['TASK_PROPOSAL_CONFIRMATION', proposalId]))
    .digest('hex')
    .slice(0, 32);

const parseProposal = (item: DynamoItem, expectedProposalId: string): TaskProposal => {
  const proposal = taskProposalSchema.safeParse({
    proposalId: item.proposalId,
    groupId: item.groupId,
    meetingId: item.meetingId,
    title: item.title,
    description: item.description,
    assigneeId: item.assigneeId,
    priority: item.priority,
    dueAt: item.dueAt,
    missingFields: item.missingFields,
    citations: item.citations,
    status: item.status,
    confirmedTaskId: item.confirmedTaskId,
  });
  const actorId = stringValue(item, 'actorId');
  const createdAt = stringValue(item, 'createdAt');
  const confirmedBy = stringValue(item, 'confirmedBy');
  const confirmedAt = stringValue(item, 'confirmedAt');
  if (
    !proposal.success ||
    item.PK !== `PROPOSAL#${expectedProposalId}` ||
    item.SK !== 'META' ||
    item.entityType !== 'TaskProposal' ||
    proposal.data.proposalId !== expectedProposalId ||
    !actorId ||
    !createdAt ||
    !persistedTimestampSchema.safeParse(createdAt).success ||
    item.GSI1PK !== `USER#${actorId}` ||
    item.GSI1SK !== `PROPOSAL#${proposal.data.status}#${expectedProposalId}` ||
    (proposal.data.status === 'CONFIRMED' &&
      (!confirmedBy || !confirmedAt || !persistedTimestampSchema.safeParse(confirmedAt).success))
  ) {
    throw new Error('TASK_PROPOSAL_DATA_INTEGRITY');
  }
  return proposal.data;
};

const parseConfirmedTask = (
  item: DynamoItem,
  proposal: TaskProposal,
): ConfirmTaskProposalResponse['task'] => {
  const response = confirmTaskProposalResponseSchema.shape.task.safeParse({
    id: item.id,
    groupId: item.groupId,
    title: item.title,
    assigneeId: item.assigneeId,
    status: item.status,
    priority: item.priority,
    dueAt: item.dueAt,
    sourceMeetingId: item.sourceMeetingId,
    createdBy: item.createdBy,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    version: item.version,
  });
  if (
    !response.success ||
    !proposal.confirmedTaskId ||
    item.PK !== `TASK#${proposal.confirmedTaskId}` ||
    item.SK !== 'META' ||
    item.entityType !== 'TASK' ||
    response.data.id !== proposal.confirmedTaskId ||
    response.data.groupId !== proposal.groupId ||
    response.data.sourceMeetingId !== proposal.meetingId ||
    item.GSI1PK !== `GROUP#${response.data.groupId}` ||
    item.GSI1SK !==
      `STATUS#TODO#DUE#${response.data.dueAt ?? NO_DUE_DATE_SORT_VALUE}#TASK#${response.data.id}` ||
    item.GSI2PK !== `USER#${response.data.assigneeId}` ||
    item.GSI2SK !==
      `DUE#${response.data.dueAt ?? NO_DUE_DATE_SORT_VALUE}#TASK#${response.data.id}` ||
    item.GSI3PK !== `MEETING#${response.data.sourceMeetingId}` ||
    item.GSI3SK !== `TASK#${response.data.createdAt}#${response.data.id}`
  ) {
    throw new Error('TASK_PROPOSAL_DATA_INTEGRITY');
  }
  return response.data;
};

export class DynamoDbTaskProposalConfirmationRepository implements TaskProposalConfirmationRepository {
  constructor(
    private readonly database = documentClient,
    private readonly aiWorkTable?: string,
    private readonly taskTable?: string,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  private aiTable() {
    return this.aiWorkTable ?? tableName('AI_WORK_TABLE');
  }

  private tasksTable() {
    return this.taskTable ?? tableName('TASK_DATA_TABLE');
  }

  async getById(proposalId: string): Promise<TaskProposal | null> {
    const result = await this.database.send(
      new GetCommand({
        TableName: this.aiTable(),
        Key: { PK: `PROPOSAL#${proposalId}`, SK: 'META' },
        ConsistentRead: true,
      }),
    );
    return result.Item ? parseProposal(result.Item, proposalId) : null;
  }

  async getConfirmed(proposal: TaskProposal): Promise<ConfirmTaskProposalResponse> {
    if (
      proposal.status !== 'CONFIRMED' ||
      !proposal.confirmedTaskId ||
      proposal.confirmedTaskId !== taskIdFor(proposal.proposalId)
    ) {
      throw new Error('TASK_PROPOSAL_DATA_INTEGRITY');
    }
    const result = await this.database.send(
      new GetCommand({
        TableName: this.tasksTable(),
        Key: { PK: `TASK#${proposal.confirmedTaskId}`, SK: 'META' },
        ConsistentRead: true,
      }),
    );
    if (!result.Item) throw new Error('TASK_PROPOSAL_DATA_INTEGRITY');
    return { task: parseConfirmedTask(result.Item, proposal), proposal };
  }

  async confirm(input: TaskProposalConfirmationWrite): Promise<ConfirmTaskProposalResponse> {
    const taskId = taskIdFor(input.proposal.proposalId);
    const createdAt = this.clock().toISOString();
    const task: Task = {
      id: taskId,
      groupId: input.proposal.groupId,
      title: input.input.title,
      assigneeId: input.input.assigneeId,
      status: TaskStatus.TODO,
      priority: input.input.priority,
      ...(input.input.dueAt ? { dueAt: input.input.dueAt } : {}),
      sourceMeetingId: input.proposal.meetingId,
      createdBy: input.actorId,
      createdAt,
      updatedAt: createdAt,
      version: 1,
    };
    const proposal = taskProposalSchema.parse({
      ...input.proposal,
      title: input.input.title,
      assigneeId: input.input.assigneeId,
      priority: input.input.priority,
      ...(input.input.dueAt ? { dueAt: input.input.dueAt } : { dueAt: undefined }),
      missingFields: [],
      status: 'CONFIRMED',
      confirmedTaskId: taskId,
    });
    const dueSortValue = task.dueAt ?? NO_DUE_DATE_SORT_VALUE;
    const updateExpression = task.dueAt
      ? 'SET dueAt = :dueAt, #status = :confirmed, confirmedTaskId = :taskId, confirmedBy = :actorId, confirmedAt = :createdAt, title = :title, assigneeId = :assigneeId, priority = :priority, missingFields = :missingFields, GSI1SK = :gsi1sk'
      : 'SET #status = :confirmed, confirmedTaskId = :taskId, confirmedBy = :actorId, confirmedAt = :createdAt, title = :title, assigneeId = :assigneeId, priority = :priority, missingFields = :missingFields, GSI1SK = :gsi1sk REMOVE dueAt';

    try {
      await this.database.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Put: {
                TableName: this.tasksTable(),
                Item: {
                  PK: `TASK#${task.id}`,
                  SK: 'META',
                  entityType: 'TASK',
                  ...task,
                  GSI1PK: `GROUP#${task.groupId}`,
                  GSI1SK: `STATUS#${task.status}#DUE#${dueSortValue}#TASK#${task.id}`,
                  GSI2PK: `USER#${task.assigneeId}`,
                  GSI2SK: `DUE#${dueSortValue}#TASK#${task.id}`,
                  GSI3PK: `MEETING#${task.sourceMeetingId}`,
                  GSI3SK: `TASK#${createdAt}#${task.id}`,
                },
                ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
              },
            },
            {
              Update: {
                TableName: this.aiTable(),
                Key: { PK: `PROPOSAL#${input.proposal.proposalId}`, SK: 'META' },
                UpdateExpression: updateExpression,
                ConditionExpression:
                  'attribute_exists(PK) AND entityType = :entityType AND proposalId = :proposalId AND groupId = :groupId AND meetingId = :meetingId AND #status = :pending AND attribute_not_exists(confirmedTaskId)',
                ExpressionAttributeNames: { '#status': 'status' },
                ExpressionAttributeValues: {
                  ':entityType': 'TaskProposal',
                  ':proposalId': input.proposal.proposalId,
                  ':groupId': input.proposal.groupId,
                  ':meetingId': input.proposal.meetingId,
                  ':pending': 'PENDING',
                  ':confirmed': 'CONFIRMED',
                  ':taskId': taskId,
                  ':actorId': input.actorId,
                  ':createdAt': createdAt,
                  ':title': task.title,
                  ':assigneeId': task.assigneeId,
                  ':priority': task.priority,
                  ':missingFields': [],
                  ':gsi1sk': `PROPOSAL#CONFIRMED#${input.proposal.proposalId}`,
                  ...(task.dueAt ? { ':dueAt': task.dueAt } : {}),
                },
              },
            },
          ],
        }),
      );
      return confirmTaskProposalResponseSchema.parse({ task, proposal });
    } catch (error) {
      if ((error as { name?: string }).name !== 'TransactionCanceledException') throw error;
      const current = await this.getById(input.proposal.proposalId);
      if (current?.status === 'CONFIRMED') return this.getConfirmed(current);
      if (current && current.status !== 'PENDING') {
        throw new ConflictError('Đề xuất công việc không còn ở trạng thái chờ xác nhận.');
      }
      throw error;
    }
  }
}
