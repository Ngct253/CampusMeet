import { createHash, randomUUID } from 'node:crypto';
import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  BatchGetCommand,
  DynamoDBDocumentClient,
  GetCommand,
  TransactWriteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { GroupRole, type AIJob } from '@campusmeet/shared';
import { requireGroupMembership } from '../middleware/authorization';
import { ForbiddenError, ResourceNotFoundError, ServiceConfigurationError } from '../utils/errors';
import type { AIJobOrchestrator, MeetingScopeReader, MembershipAuthorizer } from './ports';

interface MeetingRecord {
  groupId?: string;
  organizerId?: string;
}

const requireValue = (value: string | undefined, name: string): string => {
  if (!value) throw new ServiceConfigurationError(`Thiếu cấu hình ${name}.`);
  return value;
};

export class DynamoAiAccessAdapter implements MembershipAuthorizer, MeetingScopeReader {
  constructor(
    private readonly database: DynamoDBDocumentClient,
    private readonly meetingTable: string,
    private readonly authorizeGroup: typeof requireGroupMembership = requireGroupMembership,
  ) {}

  async requireMember(actorId: string, groupId: string): Promise<void> {
    await this.authorizeGroup(actorId, groupId);
  }

  async requireGroupAdmin(actorId: string, groupId: string): Promise<void> {
    await this.authorizeGroup(actorId, groupId, GroupRole.GROUP_ADMIN);
  }

  async requireMeetingOrganizerOrAdmin(actorId: string, meetingId: string): Promise<string> {
    const meeting = await this.getMeeting(meetingId);
    if (meeting.organizerId === actorId) {
      await this.requireMember(actorId, meeting.groupId);
      return meeting.groupId;
    }
    await this.requireGroupAdmin(actorId, meeting.groupId);
    return meeting.groupId;
  }

  async getMeetingGroupId(meetingId: string): Promise<string> {
    return (await this.getMeeting(meetingId)).groupId;
  }

  async requireMeetingsInGroup(meetingIds: string[], groupId: string): Promise<void> {
    if (!meetingIds.length) throw new ForbiddenError('Danh sách cuộc họp không hợp lệ.');
    const uniqueIds = [...new Set(meetingIds)];
    const result = await this.database.send(
      new BatchGetCommand({
        RequestItems: {
          [this.meetingTable]: {
            Keys: uniqueIds.map((meetingId) => ({ PK: `MEETING#${meetingId}`, SK: 'META' })),
            ConsistentRead: true,
            ProjectionExpression: 'PK, groupId',
          },
        },
      }),
    );
    const meetings = (result.Responses?.[this.meetingTable] ?? []) as MeetingRecord[];
    if (
      meetings.length !== uniqueIds.length ||
      meetings.some((meeting) => meeting.groupId !== groupId)
    ) {
      throw new ForbiddenError('Mọi cuộc họp được chọn phải thuộc cùng nhóm.');
    }
  }

  private async getMeeting(meetingId: string): Promise<{ groupId: string; organizerId?: string }> {
    const result = await this.database.send(
      new GetCommand({
        TableName: this.meetingTable,
        Key: { PK: `MEETING#${meetingId}`, SK: 'META' },
        ConsistentRead: true,
        ProjectionExpression: 'groupId, organizerId',
      }),
    );
    const meeting = result.Item as MeetingRecord | undefined;
    if (!meeting?.groupId) throw new ResourceNotFoundError('Không tìm thấy cuộc họp.');
    return { groupId: meeting.groupId, organizerId: meeting.organizerId };
  }
}

export class StepFunctionsAIJobOrchestrator implements AIJobOrchestrator {
  constructor(
    private readonly database: DynamoDBDocumentClient,
    private readonly stateMachines: SFNClient,
    private readonly tableName: string,
    private readonly stateMachineArn: string,
  ) {}

  async enqueue(input: Parameters<AIJobOrchestrator['enqueue']>[0]): Promise<AIJob> {
    const now = new Date().toISOString();
    const aiJobId = `aij_${randomUUID()}`;
    const keyHash = createHash('sha256')
      .update(
        `${input.actorId}:${input.groupId}:${input.payload.operation}:${input.idempotencyKey}`,
      )
      .digest('hex');
    const idempotencyKey = { PK: `IDEMPOTENCY#AI_REQUEST#${keyHash}`, SK: 'RESULT' };
    const job: AIJob = {
      aiJobId,
      groupId: input.groupId,
      ...(input.meetingId ? { meetingId: input.meetingId } : {}),
      type: input.type,
      status: 'QUEUED',
      attempt: 0,
      requestId: input.requestId,
      provider: 'BEDROCK',
      createdAt: now,
      updatedAt: now,
    };

    try {
      await this.database.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Put: {
                TableName: this.tableName,
                Item: {
                  PK: `AIJOB#${aiJobId}`,
                  SK: 'META',
                  entityType: 'AIJob',
                  ...job,
                  payload: input.payload,
                  GSI1PK: `GROUP#${input.groupId}`,
                  GSI1SK: `AIJOB#${now}#${aiJobId}`,
                  GSI2PK: 'AIJOB_STATUS#QUEUED',
                  GSI2SK: `${now}#${aiJobId}`,
                },
                ConditionExpression: 'attribute_not_exists(PK)',
              },
            },
            {
              Put: {
                TableName: this.tableName,
                Item: {
                  ...idempotencyKey,
                  entityType: 'IdempotencyResult',
                  aiJobId,
                  expiresAt: Math.floor(Date.now() / 1000) + 86_400,
                },
                ConditionExpression: 'attribute_not_exists(PK)',
              },
            },
          ],
        }),
      );
    } catch (error) {
      const existing = await this.database.send(
        new GetCommand({ TableName: this.tableName, Key: idempotencyKey, ConsistentRead: true }),
      );
      const existingJobId = existing.Item?.aiJobId as string | undefined;
      if (!existingJobId) throw error;
      const existingJob = await this.database.send(
        new GetCommand({
          TableName: this.tableName,
          Key: { PK: `AIJOB#${existingJobId}`, SK: 'META' },
          ConsistentRead: true,
        }),
      );
      if (!existingJob.Item) throw error;
      return this.toJob(existingJob.Item);
    }

    try {
      await this.stateMachines.send(
        new StartExecutionCommand({
          stateMachineArn: this.stateMachineArn,
          name: aiJobId.replace(/[^A-Za-z0-9-_]/g, '-'),
          input: JSON.stringify({ aiJobId }),
        }),
      );
    } catch (error) {
      await this.database.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { PK: `AIJOB#${aiJobId}`, SK: 'META' },
          UpdateExpression:
            'SET #status = :failed, errorCode = :code, updatedAt = :now, GSI2PK = :gsi',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: {
            ':failed': 'FAILED',
            ':code': 'ORCHESTRATION_START_FAILED',
            ':now': new Date().toISOString(),
            ':gsi': 'AIJOB_STATUS#FAILED',
          },
        }),
      );
      throw error;
    }
    return job;
  }

  private toJob(item: Record<string, unknown>): AIJob {
    return {
      aiJobId: String(item.aiJobId),
      groupId: String(item.groupId),
      ...(item.meetingId ? { meetingId: String(item.meetingId) } : {}),
      type: item.type as AIJob['type'],
      status: item.status as AIJob['status'],
      attempt: Number(item.attempt),
      requestId: String(item.requestId),
      provider: 'BEDROCK',
      createdAt: String(item.createdAt),
      updatedAt: String(item.updatedAt),
    };
  }
}

export const createProductionAIRequestServiceAdapters = () => {
  const meetingTable = requireValue(process.env.MEETING_DATA_TABLE, 'MEETING_DATA_TABLE');
  const aiWorkTable = requireValue(process.env.AI_WORK_TABLE, 'AI_WORK_TABLE');
  const stateMachineArn = requireValue(process.env.AI_STATE_MACHINE_ARN, 'AI_STATE_MACHINE_ARN');
  const database = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  const access = new DynamoAiAccessAdapter(database, meetingTable);
  const jobs = new StepFunctionsAIJobOrchestrator(
    database,
    new SFNClient({}),
    aiWorkTable,
    stateMachineArn,
  );
  return { access, meetings: access, jobs };
};
