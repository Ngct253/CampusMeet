import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { taskProposalSchema, type TaskProposal } from '@campusmeet/shared';
import type { TaskProposalConfirmationRepository } from '../domain/ports';
import { ConflictError } from '../utils/errors';
import { documentClient, tableName } from './client';

const proposalFrom = (item: Record<string, unknown> | undefined): TaskProposal | undefined => {
  const parsed = taskProposalSchema.safeParse(item);
  return parsed.success ? parsed.data : undefined;
};

const conditionalConflict = (error: unknown): never => {
  if ((error as { name?: string }).name === 'ConditionalCheckFailedException') {
    throw new ConflictError('Đề xuất công việc đã được xác nhận bởi yêu cầu khác.');
  }
  throw error;
};

export class DynamoDbTaskProposalConfirmationRepository
  implements TaskProposalConfirmationRepository
{
  async getById(proposalId: string): Promise<TaskProposal | undefined> {
    const response = await documentClient.send(
      new GetCommand({
        TableName: tableName('AI_WORK_TABLE'),
        Key: { PK: `PROPOSAL#${proposalId}`, SK: 'META' },
        ConsistentRead: true,
      }),
    );
    return proposalFrom(response.Item);
  }

  async claim(proposalId: string, actorId: string, idempotencyKey: string) {
    try {
      const response = await documentClient.send(
        new UpdateCommand({
          TableName: tableName('AI_WORK_TABLE'),
          Key: { PK: `PROPOSAL#${proposalId}`, SK: 'META' },
          UpdateExpression:
            'SET #status = :confirmed, confirmedBy = :actor, confirmationKey = :key, confirmedAt = :now, updatedAt = :now, GSI1SK = :gsi',
          ConditionExpression:
            '#status = :pending OR (#status = :confirmed AND confirmedBy = :actor AND confirmationKey = :key)',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: {
            ':pending': 'PENDING',
            ':confirmed': 'CONFIRMED',
            ':actor': actorId,
            ':key': idempotencyKey,
            ':now': new Date().toISOString(),
            ':gsi': `PROPOSAL#CONFIRMED#${proposalId}`,
          },
          ReturnValues: 'ALL_NEW',
        }),
      );
      const proposal = proposalFrom(response.Attributes);
      if (!proposal) throw new ConflictError('Đề xuất công việc không còn hợp lệ.');
      return proposal;
    } catch (error) {
      return conditionalConflict(error);
    }
  }

  async markExecuted(
    proposalId: string,
    actorId: string,
    idempotencyKey: string,
    taskId: string,
  ) {
    try {
      const response = await documentClient.send(
        new UpdateCommand({
          TableName: tableName('AI_WORK_TABLE'),
          Key: { PK: `PROPOSAL#${proposalId}`, SK: 'META' },
          UpdateExpression:
            'SET #status = :executed, taskId = :taskId, executedAt = :now, updatedAt = :now, GSI1SK = :gsi',
          ConditionExpression:
            '#status = :confirmed AND confirmedBy = :actor AND confirmationKey = :key',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: {
            ':confirmed': 'CONFIRMED',
            ':executed': 'EXECUTED',
            ':actor': actorId,
            ':key': idempotencyKey,
            ':taskId': taskId,
            ':now': new Date().toISOString(),
            ':gsi': `PROPOSAL#EXECUTED#${proposalId}`,
          },
          ReturnValues: 'ALL_NEW',
        }),
      );
      const proposal = proposalFrom(response.Attributes);
      if (!proposal) throw new ConflictError('Đề xuất công việc không còn hợp lệ.');
      return proposal;
    } catch (error) {
      return conditionalConflict(error);
    }
  }
}
