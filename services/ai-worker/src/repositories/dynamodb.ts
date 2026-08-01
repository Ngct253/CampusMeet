import {
  BatchWriteCommand,
  type DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  aiJobSchema,
  aiWorkerPayloadSchema,
  groupProgressSnapshotSchema,
  knowledgeSourceSchema,
  type ConversationMessage,
  type GroupProgressSnapshot,
  type KnowledgeSource,
  type TaskProposal,
} from '@campusmeet/shared';
import type {
  AIJobRecord,
  AIJobRepository,
  ConversationRepository,
  GroupProgressSnapshotReader,
  KnowledgeSourceRepository,
  TaskProposalGateway,
} from '../domain/ports';

const versionKey = (version: number) => `VERSION#${String(version).padStart(10, '0')}`;
const expiresIn30Days = () => Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
const sameSourceIdentity = (left: KnowledgeSource, right: KnowledgeSource) =>
  left.sourceId === right.sourceId &&
  left.groupId === right.groupId &&
  left.meetingId === right.meetingId &&
  left.sourceType === right.sourceType &&
  left.version === right.version &&
  left.approved === right.approved &&
  left.normalizedObjectKey === right.normalizedObjectKey;

export class DynamoAIJobRepository implements AIJobRepository {
  constructor(
    private readonly database: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  async get(aiJobId: string): Promise<AIJobRecord | null> {
    const response = await this.database.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { PK: `AIJOB#${aiJobId}`, SK: 'META' },
        ConsistentRead: true,
      }),
    );
    if (!response.Item) return null;
    return {
      job: aiJobSchema.parse(response.Item),
      payload: aiWorkerPayloadSchema.parse(response.Item.payload),
      ...(response.Item.result === undefined ? {} : { result: response.Item.result }),
    };
  }

  async markProcessing(aiJobId: string): Promise<void> {
    const now = new Date().toISOString();
    await this.database.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { PK: `AIJOB#${aiJobId}`, SK: 'META' },
        UpdateExpression:
          'SET #status = :processing, updatedAt = :now, GSI2PK = :gsi, GSI2SK = :gsiSort ADD attempt :one',
        ConditionExpression: '#status IN (:queued, :processing)',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':processing': 'PROCESSING',
          ':queued': 'QUEUED',
          ':now': now,
          ':gsi': 'AIJOB_STATUS#PROCESSING',
          ':gsiSort': `${now}#${aiJobId}`,
          ':one': 1,
        },
      }),
    );
  }

  async markCompleted(aiJobId: string, result: unknown): Promise<void> {
    await this.finish(aiJobId, 'COMPLETED', { result });
  }

  async markFailed(aiJobId: string, errorCode: string): Promise<void> {
    await this.finish(aiJobId, 'FAILED', { errorCode });
  }

  private async finish(
    aiJobId: string,
    status: 'COMPLETED' | 'FAILED',
    value: { result: unknown } | { errorCode: string },
  ) {
    const now = new Date().toISOString();
    const isCompleted = 'result' in value;
    await this.database.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { PK: `AIJOB#${aiJobId}`, SK: 'META' },
        UpdateExpression: `SET #status = :status, updatedAt = :now, GSI2PK = :gsi, GSI2SK = :gsiSort, ${isCompleted ? '#result = :value' : 'errorCode = :value'}`,
        ConditionExpression: '#status <> :cancelled',
        ExpressionAttributeNames: {
          '#status': 'status',
          ...(isCompleted ? { '#result': 'result' } : {}),
        },
        ExpressionAttributeValues: {
          ':status': status,
          ':cancelled': 'CANCELLED',
          ':now': now,
          ':gsi': `AIJOB_STATUS#${status}`,
          ':gsiSort': `${now}#${aiJobId}`,
          ':value': isCompleted ? value.result : value.errorCode,
        },
      }),
    );
  }
}

export class DynamoKnowledgeSourceRepository implements KnowledgeSourceRepository {
  constructor(
    private readonly database: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  async saveVersion(source: KnowledgeSource): Promise<KnowledgeSource> {
    const validated = knowledgeSourceSchema.parse(source);
    try {
      await this.database.send(
        new PutCommand({
          TableName: this.tableName,
          Item: {
            PK: `SOURCE#${validated.sourceId}`,
            SK: versionKey(validated.version),
            entityType: 'KnowledgeSource',
            ...validated,
            GSI1PK: `GROUP#${validated.groupId}`,
            GSI1SK: `SOURCE#${validated.meetingId}#${validated.sourceType}#${validated.sourceId}#${versionKey(validated.version)}`,
          },
          ConditionExpression: 'attribute_not_exists(PK)',
        }),
      );
      return validated;
    } catch (error) {
      const existing = await this.getVersion(validated.sourceId, validated.version);
      if (!existing || !sameSourceIdentity(existing, validated)) throw error;
      return existing;
    }
  }

  async markOlderVersionsStale(sourceId: string, currentVersion: number): Promise<void> {
    const response = await this.database.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'PK = :pk AND SK < :current',
        ExpressionAttributeValues: {
          ':pk': `SOURCE#${sourceId}`,
          ':current': versionKey(currentVersion),
        },
        ProjectionExpression: 'PK, SK',
      }),
    );
    await Promise.all(
      (response.Items ?? []).map((item) =>
        this.database.send(
          new UpdateCommand({
            TableName: this.tableName,
            Key: { PK: item.PK, SK: item.SK },
            UpdateExpression: 'SET ingestionStatus = :stale, updatedAt = :now',
            ExpressionAttributeValues: {
              ':stale': 'STALE',
              ':now': new Date().toISOString(),
            },
          }),
        ),
      ),
    );
  }

  async markIngestionStatus(
    sourceId: string,
    version: number,
    status: 'READY' | 'FAILED',
  ): Promise<void> {
    await this.database.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { PK: `SOURCE#${sourceId}`, SK: versionKey(version) },
        UpdateExpression: 'SET ingestionStatus = :status, updatedAt = :now',
        ConditionExpression: 'attribute_exists(PK) AND ingestionStatus <> :stale',
        ExpressionAttributeValues: {
          ':status': status,
          ':stale': 'STALE',
          ':now': new Date().toISOString(),
        },
      }),
    );
  }

  private async getVersion(sourceId: string, version: number): Promise<KnowledgeSource | null> {
    const response = await this.database.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { PK: `SOURCE#${sourceId}`, SK: versionKey(version) },
        ConsistentRead: true,
      }),
    );
    return response.Item ? knowledgeSourceSchema.parse(response.Item) : null;
  }
}

export class DynamoConversationRepository implements ConversationRepository {
  constructor(
    private readonly database: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  async saveExchange(input: Parameters<ConversationRepository['saveExchange']>[0]): Promise<void> {
    const pk = `CONVERSATION#${input.conversation.conversationId}`;
    const messageItem = (message: ConversationMessage) => ({
      PK: pk,
      SK: `MESSAGE#${message.createdAt}#${message.messageId}`,
      entityType: 'ConversationMessage',
      ...message,
      citations: undefined,
      expiresAtEpoch: expiresIn30Days(),
    });
    await this.database.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: this.tableName,
              Item: {
                PK: pk,
                SK: 'META',
                entityType: 'Conversation',
                ...input.conversation,
                GSI1PK: `USER#${input.conversation.userId}`,
                GSI1SK: `CONVERSATION#${input.conversation.updatedAt}#${input.conversation.conversationId}`,
                expiresAtEpoch: expiresIn30Days(),
              },
            },
          },
          { Put: { TableName: this.tableName, Item: messageItem(input.question) } },
          { Put: { TableName: this.tableName, Item: messageItem(input.answer) } },
        ],
      }),
    );
    for (let offset = 0; offset < input.answer.citations.length; offset += 25) {
      const slice = input.answer.citations.slice(offset, offset + 25);
      await this.database.send(
        new BatchWriteCommand({
          RequestItems: {
            [this.tableName]: slice.map((citation, index) => ({
              PutRequest: {
                Item: {
                  PK: pk,
                  SK: `CITATION#${input.answer.messageId}#${String(offset + index).padStart(3, '0')}`,
                  entityType: 'Citation',
                  messageId: input.answer.messageId,
                  ...citation,
                  expiresAtEpoch: expiresIn30Days(),
                },
              },
            })),
          },
        }),
      );
    }
  }
}

export class DynamoTaskProposalGateway implements TaskProposalGateway {
  constructor(
    private readonly database: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  async save(proposals: TaskProposal[], actorId: string): Promise<void> {
    for (let offset = 0; offset < proposals.length; offset += 25) {
      const slice = proposals.slice(offset, offset + 25);
      await this.database.send(
        new TransactWriteCommand({
          TransactItems: slice.map((proposal) => ({
            Put: {
              TableName: this.tableName,
              Item: {
                PK: `PROPOSAL#${proposal.proposalId}`,
                SK: 'META',
                entityType: 'TaskProposal',
                ...proposal,
                actorId,
                createdAt: new Date().toISOString(),
                GSI1PK: `USER#${actorId}`,
                GSI1SK: `PROPOSAL#${proposal.status}#${proposal.proposalId}`,
              },
              ConditionExpression: 'attribute_not_exists(PK)',
            },
          })),
        }),
      );
    }
  }
}

export class DynamoGroupProgressSnapshotReader implements GroupProgressSnapshotReader {
  constructor(
    private readonly database: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  async get(groupId: string, version?: number): Promise<GroupProgressSnapshot> {
    const response = await this.database.send(
      new GetCommand({
        TableName: this.tableName,
        Key: {
          PK: `GROUP#${groupId}`,
          SK: version ? `PROGRESS_SNAPSHOT#${versionKey(version)}` : 'PROGRESS_SNAPSHOT#LATEST',
        },
        ConsistentRead: true,
      }),
    );
    if (!response.Item) throw new Error('GROUP_PROGRESS_SNAPSHOT_NOT_FOUND');
    return groupProgressSnapshotSchema.parse(response.Item);
  }
}
