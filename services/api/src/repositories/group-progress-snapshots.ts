import {
  GetCommand,
  TransactWriteCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';
import { groupProgressSnapshotSchema, type GroupProgressSnapshot } from '@campusmeet/shared';
import type { GroupProgressSnapshotRepository } from '../domain/ports';
import { documentClient, tableName, type DynamoItem } from './client';

const LATEST_SK = 'PROGRESS_SNAPSHOT#LATEST';
const VERSION_PREFIX = 'PROGRESS_SNAPSHOT#VERSION#';
const MAX_VERSION = 9_999_999_999;

export const progressSnapshotVersionKey = (version: number) => {
  if (!Number.isInteger(version) || version < 1 || version > MAX_VERSION) {
    throw new Error('GROUP_PROGRESS_SNAPSHOT_VERSION_INVALID');
  }
  return `${VERSION_PREFIX}${String(version).padStart(10, '0')}`;
};

export class SnapshotPublishConflictError extends Error {
  constructor() {
    super('GROUP_PROGRESS_SNAPSHOT_CONCURRENT_PUBLISH');
    this.name = 'SnapshotPublishConflictError';
  }
}

const parsePersistedSnapshot = (
  item: DynamoItem,
  expectedGroupId: string,
  expected: { recordType: 'LATEST' } | { recordType: 'VERSION'; version: number },
): GroupProgressSnapshot => {
  const expectedPk = `GROUP#${expectedGroupId}`;
  const expectedSk =
    expected.recordType === 'LATEST' ? LATEST_SK : progressSnapshotVersionKey(expected.version);
  const snapshot = groupProgressSnapshotSchema.safeParse({
    groupId: item.groupId,
    version: item.version,
    generatedAt: item.generatedAt,
    taskCounts: item.taskCounts,
    meetingCounts: item.meetingCounts,
  });

  if (
    !snapshot.success ||
    item.PK !== expectedPk ||
    item.SK !== expectedSk ||
    item.entityType !== 'GROUP_PROGRESS_SNAPSHOT' ||
    item.recordType !== expected.recordType ||
    item.groupId !== expectedGroupId ||
    typeof item.generationId !== 'string' ||
    item.generationId.length === 0 ||
    (expected.recordType === 'VERSION' && item.version !== expected.version)
  ) {
    throw new Error('GROUP_PROGRESS_SNAPSHOT_DATA_INTEGRITY');
  }

  return snapshot.data;
};

export class DynamoDbGroupProgressSnapshotRepository implements GroupProgressSnapshotRepository {
  constructor(
    private readonly database: DynamoDBDocumentClient = documentClient,
    private readonly taskTable: string = tableName('TASK_DATA_TABLE'),
  ) {}

  async getLatest(groupId: string): Promise<GroupProgressSnapshot | null> {
    const response = await this.database.send(
      new GetCommand({
        TableName: this.taskTable,
        Key: { PK: `GROUP#${groupId}`, SK: LATEST_SK },
        ConsistentRead: true,
      }),
    );
    return response.Item
      ? parsePersistedSnapshot(response.Item, groupId, { recordType: 'LATEST' })
      : null;
  }

  async getVersion(groupId: string, version: number): Promise<GroupProgressSnapshot | null> {
    const response = await this.database.send(
      new GetCommand({
        TableName: this.taskTable,
        Key: { PK: `GROUP#${groupId}`, SK: progressSnapshotVersionKey(version) },
        ConsistentRead: true,
      }),
    );
    return response.Item
      ? parsePersistedSnapshot(response.Item, groupId, { recordType: 'VERSION', version })
      : null;
  }

  async publish(
    snapshot: GroupProgressSnapshot,
    expectedPreviousVersion: number,
    generationId: string,
  ): Promise<void> {
    const validated = groupProgressSnapshotSchema.parse(snapshot);
    if (validated.version !== expectedPreviousVersion + 1 || !generationId) {
      throw new Error('GROUP_PROGRESS_SNAPSHOT_PUBLISH_INPUT_INVALID');
    }

    const common = {
      PK: `GROUP#${validated.groupId}`,
      entityType: 'GROUP_PROGRESS_SNAPSHOT',
      generationId,
      ...validated,
    };

    try {
      await this.database.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Put: {
                TableName: this.taskTable,
                Item: {
                  ...common,
                  SK: progressSnapshotVersionKey(validated.version),
                  recordType: 'VERSION',
                },
                ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
              },
            },
            {
              Put: {
                TableName: this.taskTable,
                Item: { ...common, SK: LATEST_SK, recordType: 'LATEST' },
                ConditionExpression:
                  expectedPreviousVersion === 0
                    ? 'attribute_not_exists(PK) AND attribute_not_exists(SK)'
                    : '#version = :expectedPreviousVersion AND entityType = :entityType AND recordType = :recordType',
                ...(expectedPreviousVersion === 0
                  ? {}
                  : {
                      ExpressionAttributeNames: { '#version': 'version' },
                      ExpressionAttributeValues: {
                        ':expectedPreviousVersion': expectedPreviousVersion,
                        ':entityType': 'GROUP_PROGRESS_SNAPSHOT',
                        ':recordType': 'LATEST',
                      },
                    }),
              },
            },
          ],
        }),
      );
    } catch (error) {
      if ((error as { name?: string }).name !== 'TransactionCanceledException') throw error;

      const latest = await this.getLatest(validated.groupId);
      if ((latest?.version ?? 0) !== expectedPreviousVersion) {
        throw new SnapshotPublishConflictError();
      }
      if (await this.getVersion(validated.groupId, validated.version)) {
        throw new SnapshotPublishConflictError();
      }
      throw error;
    }
  }
}
