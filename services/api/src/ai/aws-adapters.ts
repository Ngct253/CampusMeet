import { createHash, randomUUID } from 'node:crypto';
import { DescribeExecutionCommand, SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  TransactWriteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { GroupRole, aiWorkerPayloadSchema, type AIJob } from '@campusmeet/shared';
import { MeetingService } from '../application/meeting-service';
import type { MeetingAccessBoundary } from '../domain/ports';
import { requireGroupMembership, SharedMembershipAuthorizer } from '../middleware/authorization';
import { DynamoDbMeetingRepository } from '../repositories/dynamodb';
import { DynamoDbGroupProgressSnapshotRepository } from '../repositories/group-progress-snapshots';
import { DynamoDbGroupTaskReader } from '../repositories/tasks';
import { GroupProgressSnapshotService } from '../services/group-progress-snapshot-service';
import {
  ConflictError,
  ForbiddenError,
  ResourceNotFoundError,
  ServiceConfigurationError,
} from '../utils/errors';
import type {
  AIJobIdempotencyReader,
  AIJobOrchestrator,
  MeetingScopeReader,
  MembershipAuthorizer,
  PersistedAIJobStarter,
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

export class StepFunctionsAIJobOrchestrator
  implements AIJobOrchestrator, AIJobIdempotencyReader, PersistedAIJobStarter
{
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
    const requestPayloadHash = this.payloadHash(input.payload);
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
                  requestPayloadHash,
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
      const existingPayloadHash =
        typeof existing.Item?.requestPayloadHash === 'string'
          ? existing.Item.requestPayloadHash
          : this.payloadHash(recoveredPayload);
      if (existingPayloadHash !== requestPayloadHash) {
        throw new ConflictError('Idempotency-Key đã được dùng cho một yêu cầu AI khác.');
      }
      return this.startJob(existingJob.Item);
    }

    return this.startJob({
      PK: `AIJOB#${aiJobId}`,
      SK: 'META',
      entityType: 'AIJob',
      ...job,
      payload: input.payload,
    });
  }

  async startPersisted(aiJobId: string): Promise<AIJob> {
    return this.startJob(await this.getPersistedJob(aiJobId));
  }

  private async startJob(item: Record<string, unknown>): Promise<AIJob> {
    const aiJobId = String(item.aiJobId);
    const job = this.toJob(item);
    if (job.status === 'PROCESSING' || job.status === 'COMPLETED' || job.status === 'CANCELLED') {
      return job;
    }
    if (job.status === 'FAILED' && job.errorCode !== 'ORCHESTRATION_START_FAILED') {
      throw new Error('AI_JOB_NOT_RECOVERABLE');
    }

    try {
      await this.ensureExecution(aiJobId);
    } catch (error) {
      await this.markOrchestrationStartFailed(aiJobId);
      throw error;
    }

    if (job.status !== 'FAILED') return job;
    const now = new Date().toISOString();
    try {
      const recovered = await this.database.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { PK: `AIJOB#${aiJobId}`, SK: 'META' },
          UpdateExpression:
            'SET #status = :queued, updatedAt = :now, GSI2PK = :gsi REMOVE errorCode',
          ConditionExpression: '#status = :failed AND errorCode = :code',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: {
            ':queued': 'QUEUED',
            ':failed': 'FAILED',
            ':code': 'ORCHESTRATION_START_FAILED',
            ':now': now,
            ':gsi': 'AIJOB_STATUS#QUEUED',
          },
          ReturnValues: 'ALL_NEW',
        }),
      );
      return this.toJob(
        (recovered.Attributes ?? { ...item, status: 'QUEUED', updatedAt: now }) as Record<
          string,
          unknown
        >,
      );
    } catch (error) {
      if (!this.isConditionalFailure(error)) throw error;
      return this.toJob(await this.getPersistedJob(aiJobId));
    }
  }

  private toJob(item: Record<string, unknown>): AIJob {
    return {
      aiJobId: String(item.aiJobId),
      groupId: String(item.groupId),
      ...(item.meetingId ? { meetingId: String(item.meetingId) } : {}),
      ...(item.sourceId ? { sourceId: String(item.sourceId) } : {}),
      type: item.type as AIJob['type'],
      status: item.status as AIJob['status'],
      attempt: Number(item.attempt),
      requestId: String(item.requestId),
      provider: 'BEDROCK',
      ...(item.inputTokens === undefined ? {} : { inputTokens: Number(item.inputTokens) }),
      ...(item.outputTokens === undefined ? {} : { outputTokens: Number(item.outputTokens) }),
      ...(item.estimatedCostUsd === undefined
        ? {}
        : { estimatedCostUsd: Number(item.estimatedCostUsd) }),
      ...(item.errorCode === undefined ? {} : { errorCode: String(item.errorCode) }),
      createdAt: String(item.createdAt),
      updatedAt: String(item.updatedAt),
    };
  }

  private async getPersistedJob(aiJobId: string): Promise<Record<string, unknown>> {
    const result = await this.database.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { PK: `AIJOB#${aiJobId}`, SK: 'META' },
        ConsistentRead: true,
      }),
    );
    if (!result.Item) throw new Error('AI_JOB_NOT_FOUND');
    if (result.Item.aiJobId !== aiJobId || result.Item.entityType !== 'AIJob') {
      throw new Error('AI_JOB_DATA_INTEGRITY');
    }
    this.parseRecoveredPayload(result.Item);
    return result.Item;
  }

  private async ensureExecution(aiJobId: string): Promise<void> {
    const name = aiJobId.replace(/[^A-Za-z0-9-_]/g, '-');
    const input = JSON.stringify({ aiJobId });
    const start = () =>
      this.stateMachines.send(
        new StartExecutionCommand({ stateMachineArn: this.stateMachineArn, name, input }),
      );
    try {
      await start();
      return;
    } catch (firstError) {
      if (await this.reconcileExecution(name, input)) return;
      try {
        await start();
        return;
      } catch (retryError) {
        if (await this.reconcileExecution(name, input)) return;
        throw retryError ?? firstError;
      }
    }
  }

  private async reconcileExecution(name: string, expectedInput: string): Promise<boolean> {
    try {
      const execution = await this.stateMachines.send(
        new DescribeExecutionCommand({ executionArn: this.executionArn(name) }),
      );
      if (execution.stateMachineArn !== this.stateMachineArn || execution.input !== expectedInput) {
        throw new Error('AI_ORCHESTRATION_DATA_INTEGRITY');
      }
      return true;
    } catch (error) {
      if ((error as { name?: string })?.name === 'ExecutionDoesNotExist') return false;
      throw error;
    }
  }

  private executionArn(name: string): string {
    const marker = ':stateMachine:';
    const index = this.stateMachineArn.indexOf(marker);
    if (index < 0) throw new Error('AI_STATE_MACHINE_ARN_INVALID');
    return `${this.stateMachineArn.slice(0, index)}:execution:${this.stateMachineArn.slice(index + marker.length)}:${name}`;
  }

  private async markOrchestrationStartFailed(aiJobId: string): Promise<void> {
    const now = new Date().toISOString();
    await this.database.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { PK: `AIJOB#${aiJobId}`, SK: 'META' },
        UpdateExpression:
          'SET #status = :failed, errorCode = :code, updatedAt = :now, GSI2PK = :gsi',
        ConditionExpression: '#status = :queued OR (#status = :failed AND errorCode = :code)',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':queued': 'QUEUED',
          ':failed': 'FAILED',
          ':code': 'ORCHESTRATION_START_FAILED',
          ':now': now,
          ':gsi': 'AIJOB_STATUS#FAILED',
        },
      }),
    );
  }

  private isConditionalFailure(error: unknown): boolean {
    return (error as { name?: string })?.name === 'ConditionalCheckFailedException';
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

  private payloadHash(payload: unknown) {
    return createHash('sha256')
      .update(JSON.stringify(aiWorkerPayloadSchema.parse(payload)))
      .digest('hex');
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

export const createProductionAIJobOrchestrator = (): StepFunctionsAIJobOrchestrator => {
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
