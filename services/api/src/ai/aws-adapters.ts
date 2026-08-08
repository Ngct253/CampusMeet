import { createHash, randomUUID } from 'node:crypto';
import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  TransactWriteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { GroupRole, aiJobSchema, aiWorkerPayloadSchema, type AIJob } from '@campusmeet/shared';
import { MeetingService } from '../application/meeting-service';
import type { MeetingAccessBoundary } from '../domain/ports';
import { requireGroupMembership, SharedMembershipAuthorizer } from '../middleware/authorization';
import { DynamoDbMeetingRepository } from '../repositories/dynamodb';
import { DynamoDbGroupProgressSnapshotRepository } from '../repositories/group-progress-snapshots';
import { DynamoDbGroupTaskReader } from '../repositories/tasks';
import { GroupProgressSnapshotService } from '../services/group-progress-snapshot-service';
import { ForbiddenError, ResourceNotFoundError, ServiceConfigurationError } from '../utils/errors';
import type {
  AIJobIdempotencyReader,
  AIJobOrchestrator,
  MeetingScopeReader,
  MembershipAuthorizer,
} from './ports';

const requireValue = (value: string | undefined, name: string): string => {
  if (!value) throw new ServiceConfigurationError(`Thiếu cấu hình ${name}.`);
  return value;
};

export class DynamoAiAccessAdapter implements MembershipAuthorizer, MeetingScopeReader {
  constructor(
    private readonly meetings: MeetingAccessBoundary,
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
    const meetings = await Promise.all(
      uniqueIds.map((meetingId) => this.meetings.getMeeting(meetingId)),
    );
    if (meetings.some((meeting) => !meeting || meeting.groupId !== groupId)) {
      throw new ForbiddenError('Mọi cuộc họp được chọn phải thuộc cùng nhóm.');
    }
  }

  private async getMeeting(meetingId: string): Promise<{ groupId: string; organizerId?: string }> {
    const meeting = await this.meetings.getMeeting(meetingId);
    if (!meeting) throw new ResourceNotFoundError('Không tìm thấy cuộc họp.');
    return { groupId: meeting.groupId, organizerId: meeting.organizerId };
  }
}

export class StepFunctionsAIJobOrchestrator implements AIJobOrchestrator, AIJobIdempotencyReader {
  constructor(
    private readonly database: DynamoDBDocumentClient,
    private readonly stateMachines: SFNClient,
    private readonly tableName: string,
    private readonly stateMachineArn: string,
  ) {}

  async findExisting(
    input: Parameters<AIJobIdempotencyReader['findExisting']>[0],
  ): ReturnType<AIJobIdempotencyReader['findExisting']> {
    const idempotencyKey = this.idempotencyKey(input);
    const existing = await this.database.send(
      new GetCommand({ TableName: this.tableName, Key: idempotencyKey, ConsistentRead: true }),
    );
    if (!existing.Item) return null;

    const existingJobId = existing.Item.aiJobId as string | undefined;
    if (!existingJobId) throw new Error('AI_IDEMPOTENCY_DATA_INTEGRITY');
    const existingJob = await this.database.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { PK: `AIJOB#${existingJobId}`, SK: 'META' },
        ConsistentRead: true,
      }),
    );
    if (!existingJob.Item) throw new Error('AI_IDEMPOTENCY_DATA_INTEGRITY');
    const job = this.toJob(existingJob.Item);
    const payload = this.parseRecoveredPayload(existingJob.Item);
    this.assertRecoveredPayloadScope(job, payload, input);
    return {
      job,
      payload,
    };
  }

  async enqueue(input: Parameters<AIJobOrchestrator['enqueue']>[0]): Promise<AIJob> {
    const now = new Date().toISOString();
    const aiJobId = `aij_${randomUUID()}`;
    const executionName = aiJobId.replace(/[^A-Za-z0-9-_]/g, '-');
    const idempotencyKey = this.idempotencyKey({
      actorId: input.actorId,
      groupId: input.groupId,
      operation: input.payload.operation,
      idempotencyKey: input.idempotencyKey,
    });
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
                  orchestrationState: 'STARTING',
                  executionName,
                  orchestrationAttempt: 1,
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
      const recoveredJob = this.toJob(existingJob.Item);
      const recoveredPayload = this.parseRecoveredPayload(existingJob.Item);
      this.assertRecoveredPayloadScope(recoveredJob, recoveredPayload, {
        actorId: input.actorId,
        groupId: input.groupId,
        operation: input.payload.operation,
      });
      if (
        input.payload.operation === 'PROGRESS_ANALYSIS' &&
        (recoveredPayload.operation !== 'PROGRESS_ANALYSIS' ||
          recoveredPayload.request.snapshotVersion !== input.payload.request.snapshotVersion)
      ) {
        throw new Error('AI_IDEMPOTENCY_DATA_INTEGRITY');
      }
      return recoveredJob;
    }

    try {
      await this.stateMachines.send(
        new StartExecutionCommand({
          stateMachineArn: this.stateMachineArn,
          name: executionName,
          input: JSON.stringify({ aiJobId }),
        }),
      );
    } catch (error) {
      try {
        await this.database.send(
          new UpdateCommand({
            TableName: this.tableName,
            Key: { PK: `AIJOB#${aiJobId}`, SK: 'META' },
            UpdateExpression:
              'SET #status = :failed, errorCode = :code, updatedAt = :now, GSI2PK = :gsi',
            ConditionExpression:
              '#status = :queued AND orchestrationState = :starting AND executionName = :executionName',
            ExpressionAttributeNames: { '#status': 'status' },
            ExpressionAttributeValues: {
              ':queued': 'QUEUED',
              ':failed': 'FAILED',
              ':code': 'ORCHESTRATION_START_FAILED',
              ':now': new Date().toISOString(),
              ':gsi': 'AIJOB_STATUS#FAILED',
              ':starting': 'STARTING',
              ':executionName': executionName,
            },
          }),
        );
      } catch (updateError) {
        if ((updateError as { name?: string }).name !== 'ConditionalCheckFailedException') {
          throw updateError;
        }
        const current = await this.database.send(
          new GetCommand({
            TableName: this.tableName,
            Key: { PK: `AIJOB#${aiJobId}`, SK: 'META' },
            ConsistentRead: true,
          }),
        );
        if (current.Item) {
          const currentJob = this.toJob(current.Item);
          if (
            current.Item.executionName === executionName &&
            (current.Item.orchestrationState === 'STARTED' ||
              ['PROCESSING', 'COMPLETED', 'CANCELLED'].includes(currentJob.status))
          ) {
            return currentJob;
          }
        }
        throw updateError;
      }
      throw error;
    }

    await this.database.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { PK: `AIJOB#${aiJobId}`, SK: 'META' },
        UpdateExpression: 'SET orchestrationState = :started, orchestrationStartedAt = :now',
        ConditionExpression: 'orchestrationState = :starting AND executionName = :executionName',
        ExpressionAttributeValues: {
          ':started': 'STARTED',
          ':starting': 'STARTING',
          ':executionName': executionName,
          ':now': new Date().toISOString(),
        },
      }),
    );
    return job;
  }

  async ensureStarted(aiJobId: string): Promise<AIJob> {
    const read = async () => {
      const response = await this.database.send(
        new GetCommand({
          TableName: this.tableName,
          Key: { PK: `AIJOB#${aiJobId}`, SK: 'META' },
          ConsistentRead: true,
        }),
      );
      if (!response.Item) throw new ResourceNotFoundError('Không tìm thấy AIJob.');
      const item = response.Item;
      const job = this.toJob(item);
      const payload = this.parseRecoveredPayload(item);
      if (
        !aiJobSchema.safeParse(job).success ||
        item.PK !== `AIJOB#${aiJobId}` ||
        item.SK !== 'META' ||
        item.entityType !== 'AIJob' ||
        job.aiJobId !== aiJobId ||
        payload.groupId !== job.groupId
      ) {
        throw new Error('AI_JOB_DATA_INTEGRITY');
      }
      return { item, job };
    };

    let { item, job } = await read();
    if (['PROCESSING', 'COMPLETED', 'CANCELLED'].includes(job.status)) return job;
    if (job.status === 'FAILED' && item.errorCode !== 'ORCHESTRATION_START_FAILED') return job;
    if (item.orchestrationState === 'STARTED') return job;

    let executionName =
      item.orchestrationState === 'STARTING' && typeof item.executionName === 'string'
        ? item.executionName
        : undefined;
    if (!executionName) {
      executionName = `${aiJobId.replace(/[^A-Za-z0-9-_]/g, '-')}-attempt-${randomUUID()}`.slice(
        0,
        80,
      );
      try {
        const claimed = await this.database.send(
          new UpdateCommand({
            TableName: this.tableName,
            Key: { PK: `AIJOB#${aiJobId}`, SK: 'META' },
            UpdateExpression:
              'SET #status = :queued, orchestrationState = :starting, executionName = :executionName, orchestrationAttempt = if_not_exists(orchestrationAttempt, :zero) + :one, updatedAt = :now REMOVE errorCode',
            ConditionExpression:
              '(#status = :queued AND attribute_not_exists(orchestrationState)) OR (#status = :failed AND errorCode = :startFailed)',
            ExpressionAttributeNames: { '#status': 'status' },
            ExpressionAttributeValues: {
              ':queued': 'QUEUED',
              ':failed': 'FAILED',
              ':startFailed': 'ORCHESTRATION_START_FAILED',
              ':starting': 'STARTING',
              ':executionName': executionName,
              ':zero': 0,
              ':one': 1,
              ':now': new Date().toISOString(),
            },
            ReturnValues: 'ALL_NEW',
          }),
        );
        if (!claimed.Attributes) throw new Error('AI_JOB_DATA_INTEGRITY');
        item = claimed.Attributes;
        job = this.toJob(item);
        if (item.orchestrationState !== 'STARTING' || typeof item.executionName !== 'string') {
          throw new Error('AI_JOB_DATA_INTEGRITY');
        }
        executionName = item.executionName;
      } catch (error) {
        if ((error as { name?: string }).name !== 'ConditionalCheckFailedException') throw error;
        ({ item, job } = await read());
        if (item.orchestrationState === 'STARTED') return job;
        if (item.orchestrationState !== 'STARTING' || typeof item.executionName !== 'string') {
          throw new Error('AI_JOB_DATA_INTEGRITY');
        }
        executionName = item.executionName;
      }
    }

    try {
      await this.stateMachines.send(
        new StartExecutionCommand({
          stateMachineArn: this.stateMachineArn,
          name: executionName,
          input: JSON.stringify({ aiJobId }),
        }),
      );
    } catch (error) {
      if ((error as { name?: string }).name !== 'ExecutionAlreadyExists') throw error;
    }
    const reconcilesFailedStart =
      job.status === 'FAILED' && item.errorCode === 'ORCHESTRATION_START_FAILED';
    const reconciliationTime = new Date().toISOString();
    try {
      await this.database.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { PK: `AIJOB#${aiJobId}`, SK: 'META' },
          UpdateExpression: reconcilesFailedStart
            ? 'SET orchestrationState = :started, orchestrationStartedAt = :now, #status = :queued, updatedAt = :now, GSI2PK = :queuedGsi REMOVE errorCode'
            : 'SET orchestrationState = :started, orchestrationStartedAt = :now',
          ConditionExpression: reconcilesFailedStart
            ? 'orchestrationState = :starting AND executionName = :executionName AND #status = :failed AND errorCode = :startFailed'
            : 'orchestrationState = :starting AND executionName = :executionName',
          ...(reconcilesFailedStart ? { ExpressionAttributeNames: { '#status': 'status' } } : {}),
          ExpressionAttributeValues: {
            ':started': 'STARTED',
            ':starting': 'STARTING',
            ':executionName': executionName,
            ':now': reconciliationTime,
            ...(reconcilesFailedStart
              ? {
                  ':queued': 'QUEUED',
                  ':queuedGsi': 'AIJOB_STATUS#QUEUED',
                  ':failed': 'FAILED',
                  ':startFailed': 'ORCHESTRATION_START_FAILED',
                }
              : {}),
          },
        }),
      );
      if (reconcilesFailedStart) {
        job = { ...job, status: 'QUEUED', updatedAt: reconciliationTime };
      }
    } catch (error) {
      if ((error as { name?: string }).name !== 'ConditionalCheckFailedException') throw error;
      ({ item, job } = await read());
      if (
        item.executionName === executionName &&
        item.orchestrationState === 'STARTED' &&
        !(job.status === 'FAILED' && item.errorCode === 'ORCHESTRATION_START_FAILED')
      ) {
        return job;
      }
      if (
        item.executionName !== executionName ||
        item.orchestrationState !== 'STARTING' ||
        !['PROCESSING', 'COMPLETED', 'CANCELLED'].includes(job.status)
      ) {
        throw new Error('AI_JOB_DATA_INTEGRITY');
      }
      try {
        await this.database.send(
          new UpdateCommand({
            TableName: this.tableName,
            Key: { PK: `AIJOB#${aiJobId}`, SK: 'META' },
            UpdateExpression: 'SET orchestrationState = :started, orchestrationStartedAt = :now',
            ConditionExpression:
              'orchestrationState = :starting AND executionName = :executionName AND #status IN (:processing, :completed, :cancelled)',
            ExpressionAttributeNames: { '#status': 'status' },
            ExpressionAttributeValues: {
              ':started': 'STARTED',
              ':starting': 'STARTING',
              ':executionName': executionName,
              ':processing': 'PROCESSING',
              ':completed': 'COMPLETED',
              ':cancelled': 'CANCELLED',
              ':now': new Date().toISOString(),
            },
          }),
        );
      } catch (progressError) {
        if ((progressError as { name?: string }).name !== 'ConditionalCheckFailedException') {
          throw progressError;
        }
        ({ item, job } = await read());
        if (
          item.executionName !== executionName ||
          item.orchestrationState !== 'STARTED' ||
          !['PROCESSING', 'COMPLETED', 'CANCELLED'].includes(job.status)
        ) {
          throw new Error('AI_JOB_DATA_INTEGRITY');
        }
      }
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

  private parseRecoveredPayload(item: Record<string, unknown>) {
    const parsed = aiWorkerPayloadSchema.safeParse(item.payload);
    if (!parsed.success) throw new Error('AI_IDEMPOTENCY_DATA_INTEGRITY');
    return parsed.data;
  }

  private assertRecoveredPayloadScope(
    job: AIJob,
    payload: ReturnType<StepFunctionsAIJobOrchestrator['parseRecoveredPayload']>,
    input: Pick<
      Parameters<AIJobIdempotencyReader['findExisting']>[0],
      'actorId' | 'groupId' | 'operation'
    >,
  ) {
    if (
      job.groupId !== input.groupId ||
      payload.actorId !== input.actorId ||
      payload.groupId !== input.groupId ||
      payload.operation !== input.operation
    ) {
      throw new Error('AI_IDEMPOTENCY_DATA_INTEGRITY');
    }
  }

  private idempotencyKey(input: Parameters<AIJobIdempotencyReader['findExisting']>[0]) {
    const keyHash = createHash('sha256')
      .update(`${input.actorId}:${input.groupId}:${input.operation}:${input.idempotencyKey}`)
      .digest('hex');
    return { PK: `IDEMPOTENCY#AI_REQUEST#${keyHash}`, SK: 'RESULT' };
  }
}

export const createProductionAIRequestServiceAdapters = () => {
  const meetingTable = requireValue(process.env.MEETING_DATA_TABLE, 'MEETING_DATA_TABLE');
  const taskTable = requireValue(process.env.TASK_DATA_TABLE, 'TASK_DATA_TABLE');
  const aiWorkTable = requireValue(process.env.AI_WORK_TABLE, 'AI_WORK_TABLE');
  const stateMachineArn = requireValue(process.env.AI_STATE_MACHINE_ARN, 'AI_STATE_MACHINE_ARN');
  const database = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  const meetingRepository = new DynamoDbMeetingRepository(database, meetingTable);
  const meetingBoundary = new MeetingService(meetingRepository, new SharedMembershipAuthorizer());
  const access = new DynamoAiAccessAdapter(meetingBoundary);
  const jobs = new StepFunctionsAIJobOrchestrator(
    database,
    new SFNClient({}),
    aiWorkTable,
    stateMachineArn,
  );
  const snapshots = new GroupProgressSnapshotService(
    new DynamoDbGroupProgressSnapshotRepository(database, taskTable),
    new DynamoDbGroupTaskReader(database, taskTable),
    meetingRepository,
  );
  return { access, meetings: access, jobs, snapshots, jobReplays: jobs };
};

export const createProductionAIJobOrchestrator = (): AIJobOrchestrator => {
  const aiWorkTable = requireValue(process.env.AI_WORK_TABLE, 'AI_WORK_TABLE');
  const stateMachineArn = requireValue(process.env.AI_STATE_MACHINE_ARN, 'AI_STATE_MACHINE_ARN');
  const database = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  return new StepFunctionsAIJobOrchestrator(
    database,
    new SFNClient({}),
    aiWorkTable,
    stateMachineArn,
  );
};
