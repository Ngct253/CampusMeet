import { createHash, randomUUID } from 'node:crypto';
import {
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';
import {
  MAX_TRANSCRIPT_VERSION,
  TRANSCRIPT_SEQUENCE_PADDING,
  TRANSCRIPT_VERSION_PADDING,
  transcriptSchema,
  transcriptSegmentSchema,
  transcriptWithSegmentsSchema,
  type Transcript,
  type TranscriptSegment,
} from '@campusmeet/shared';
import type { TranscriptApprovalHandoff, TranscriptRepository } from '../domain/transcript-ports';
import {
  BadRequestError,
  ConflictError,
  ResourceNotFoundError,
  UnprocessableEntityError,
} from '../utils/errors';
import { documentClient, tableName, type DynamoItem } from './client';

const integrity = (): never => {
  throw new Error('TRANSCRIPT_DATA_INTEGRITY');
};
export const transcriptReferenceKey = (version: number, transcriptId: string) =>
  `TRANSCRIPT#${String(version).padStart(TRANSCRIPT_VERSION_PADDING, '0')}#${transcriptId}`;
export const transcriptSegmentKey = (sequence: number, segmentId: string) =>
  `SEGMENT#${String(sequence).padStart(TRANSCRIPT_SEQUENCE_PADDING, '0')}#${segmentId}`;
export const transcriptApprovalHandoffKey = (version: number) =>
  `APPROVAL_HANDOFF#${String(version).padStart(TRANSCRIPT_VERSION_PADDING, '0')}`;
const approvalIntentKey = (actorId: string, idempotencyKey: string) => ({
  PK: `IDEMPOTENCY#TRANSCRIPT_APPROVAL#${createHash('sha256').update(`${actorId}:${idempotencyKey}`).digest('hex')}`,
  SK: 'RESULT',
});
type Cursor = {
  v: 1;
  meetingId: string;
  transcriptId: string;
  sequence: number;
  segmentId: string;
};
export const encodeTranscriptCursor = (
  meetingId: string,
  transcriptId: string,
  key?: DynamoItem,
) => {
  if (!key) return undefined;
  const match = /^SEGMENT#(\d{10})#(.+)$/.exec(String(key.SK ?? ''));
  if (!match || key.PK !== `TRANSCRIPT#${transcriptId}`)
    throw new Error('TRANSCRIPT_DATA_INTEGRITY');
  return Buffer.from(
    JSON.stringify({
      v: 1,
      meetingId,
      transcriptId,
      sequence: Number(match[1]),
      segmentId: match[2]!,
    } satisfies Cursor),
  ).toString('base64url');
};
export const decodeTranscriptCursor = (
  meetingId: string,
  transcriptId: string,
  cursor?: string,
) => {
  if (!cursor) return undefined;
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(cursor)) throw new Error();
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString()) as Partial<Cursor>;
    if (
      value.v !== 1 ||
      value.meetingId !== meetingId ||
      value.transcriptId !== transcriptId ||
      !Number.isInteger(value.sequence) ||
      value.sequence! < 0 ||
      typeof value.segmentId !== 'string' ||
      !value.segmentId ||
      value.segmentId.includes('#')
    )
      throw new Error();
    return {
      PK: `TRANSCRIPT#${transcriptId}`,
      SK: transcriptSegmentKey(value.sequence!, value.segmentId),
    };
  } catch {
    throw new BadRequestError('Cursor transcript không hợp lệ hoặc không thuộc phạm vi yêu cầu.');
  }
};

const parseMeta = (item: DynamoItem | undefined, id: string): Transcript | null => {
  if (!item) return null;
  const parsed = transcriptSchema.safeParse({
    transcriptId: item.transcriptId,
    meetingId: item.meetingId,
    groupId: item.groupId,
    status: item.status,
    version: item.version,
    approvedVersion: item.approvedVersion,
    approvedBy: item.approvedBy,
    approvedAt: item.approvedAt,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  });
  if (
    !parsed.success ||
    item.PK !== `TRANSCRIPT#${id}` ||
    item.SK !== 'META' ||
    item.entityType !== 'TRANSCRIPT' ||
    parsed.data.transcriptId !== id
  )
    throw new Error('TRANSCRIPT_DATA_INTEGRITY');
  return parsed.data;
};
const parseSegment = (item: DynamoItem, transcriptId: string): TranscriptSegment => {
  const parsed = transcriptSegmentSchema.safeParse({
    segmentId: item.segmentId,
    transcriptId: item.transcriptId,
    sequence: item.sequence,
    startMs: item.startMs,
    endMs: item.endMs,
    text: item.text,
    confidence: item.confidence,
    languageCode: item.languageCode,
    speakerLabel: item.speakerLabel,
    isFinal: item.isFinal,
    version: item.version,
    updatedBy: item.updatedBy,
    updatedAt: item.updatedAt,
  });
  if (
    !parsed.success ||
    item.PK !== `TRANSCRIPT#${transcriptId}` ||
    item.SK !== transcriptSegmentKey(parsed.data.sequence, parsed.data.segmentId) ||
    item.entityType !== 'TRANSCRIPT_SEGMENT' ||
    parsed.data.transcriptId !== transcriptId
  )
    throw new Error('TRANSCRIPT_DATA_INTEGRITY');
  return parsed.data;
};
const parseHandoff = (
  item: DynamoItem | undefined,
  transcriptId: string,
  version: number,
): TranscriptApprovalHandoff | null => {
  if (!item) return null;
  if (
    typeof item.transcriptId !== 'string' ||
    typeof item.meetingId !== 'string' ||
    typeof item.groupId !== 'string' ||
    !Number.isInteger(item.approvedVersion) ||
    typeof item.artifactObjectKey !== 'string' ||
    typeof item.artifactChecksum !== 'string' ||
    typeof item.aiJobId !== 'string' ||
    typeof item.createdAt !== 'string' ||
    typeof item.updatedAt !== 'string'
  )
    integrity();
  const handoff = {
    transcriptId: item.transcriptId,
    meetingId: item.meetingId,
    groupId: item.groupId,
    approvedVersion: item.approvedVersion,
    artifactObjectKey: item.artifactObjectKey,
    artifactChecksum: item.artifactChecksum,
    aiJobId: item.aiJobId,
    aiOperation: item.aiOperation,
    aiJobType: item.aiJobType,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  } as TranscriptApprovalHandoff;
  if (
    item.PK !== `TRANSCRIPT#${transcriptId}` ||
    item.SK !== transcriptApprovalHandoffKey(version) ||
    item.entityType !== 'TRANSCRIPT_APPROVAL_HANDOFF' ||
    handoff.transcriptId !== transcriptId ||
    handoff.approvedVersion !== version ||
    handoff.aiOperation !== 'INGEST_SOURCE' ||
    handoff.aiJobType !== 'INGEST_SOURCE' ||
    !handoff.meetingId ||
    !handoff.groupId ||
    !handoff.artifactObjectKey ||
    !handoff.artifactChecksum ||
    !handoff.aiJobId
  )
    integrity();
  return handoff;
};

export class DynamoDbTranscriptRepository implements TranscriptRepository {
  constructor(
    private readonly database: DynamoDBDocumentClient = documentClient,
    private readonly configuredTable?: string,
  ) {}
  private get meetingTable() {
    return this.configuredTable ?? tableName('MEETING_DATA_TABLE');
  }
  async getById(id: string) {
    const result = await this.database.send(
      new GetCommand({
        TableName: this.meetingTable,
        Key: { PK: `TRANSCRIPT#${id}`, SK: 'META' },
        ConsistentRead: true,
      }),
    );
    return parseMeta(result.Item, id);
  }
  async getAllSegments(transcriptId: string, version: number) {
    const segments: TranscriptSegment[] = [];
    let exclusiveStartKey: DynamoItem | undefined;
    const seenKeys = new Set<string>();
    do {
      const page = await this.database.send(
        new QueryCommand({
          TableName: this.meetingTable,
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
          ExpressionAttributeValues: {
            ':pk': `TRANSCRIPT#${transcriptId}`,
            ':prefix': 'SEGMENT#',
          },
          ...(exclusiveStartKey ? { ExclusiveStartKey: exclusiveStartKey } : {}),
          ConsistentRead: true,
        }),
      );
      for (const item of page.Items ?? []) {
        const segment = parseSegment(item, transcriptId);
        if (segment.version > version) integrity();
        segments.push(segment);
      }
      exclusiveStartKey = page.LastEvaluatedKey;
      if (exclusiveStartKey) {
        const serialized = JSON.stringify(exclusiveStartKey);
        if (seenKeys.has(serialized)) integrity();
        seenKeys.add(serialized);
      }
    } while (exclusiveStartKey);
    if (!segments.length) integrity();
    return segments.sort(
      (left, right) =>
        left.sequence - right.sequence ||
        (left.segmentId < right.segmentId ? -1 : left.segmentId > right.segmentId ? 1 : 0),
    );
  }
  async getApprovalHandoff(transcriptId: string, version: number) {
    const result = await this.database.send(
      new GetCommand({
        TableName: this.meetingTable,
        Key: { PK: `TRANSCRIPT#${transcriptId}`, SK: transcriptApprovalHandoffKey(version) },
        ConsistentRead: true,
      }),
    );
    return parseHandoff(result.Item, transcriptId, version);
  }
  async getApprovalIntent(actorId: string, idempotencyKey: string) {
    const key = approvalIntentKey(actorId, idempotencyKey);
    const result = await this.database.send(
      new GetCommand({ TableName: this.meetingTable, Key: key, ConsistentRead: true }),
    );
    if (!result.Item) return null;
    if (
      result.Item.PK !== key.PK ||
      result.Item.SK !== key.SK ||
      result.Item.entityType !== 'TRANSCRIPT_APPROVAL_IDEMPOTENCY' ||
      typeof result.Item.transcriptId !== 'string' ||
      !Number.isInteger(result.Item.expectedVersion)
    )
      integrity();
    return {
      transcriptId: result.Item.transcriptId,
      expectedVersion: result.Item.expectedVersion,
    };
  }
  async bindApprovalIntent(input: Parameters<TranscriptRepository['bindApprovalIntent']>[0]) {
    const key = approvalIntentKey(input.actorId, input.idempotencyKey);
    try {
      await this.database.send(
        new PutCommand({
          TableName: this.meetingTable,
          Item: {
            ...key,
            entityType: 'TRANSCRIPT_APPROVAL_IDEMPOTENCY',
            transcriptId: input.transcriptId,
            expectedVersion: input.expectedVersion,
            aiJobId: input.aiJobId,
            createdAt: new Date().toISOString(),
          },
          ConditionExpression: 'attribute_not_exists(PK)',
        }),
      );
    } catch (error) {
      if ((error as { name?: string }).name !== 'ConditionalCheckFailedException') throw error;
      const existing = await this.getApprovalIntent(input.actorId, input.idempotencyKey);
      if (
        !existing ||
        existing.transcriptId !== input.transcriptId ||
        existing.expectedVersion !== input.expectedVersion
      )
        throw new ConflictError('Idempotency-Key đã được dùng cho một yêu cầu duyệt khác.');
    }
  }
  async approve(input: Parameters<TranscriptRepository['approve']>[0]) {
    const now = new Date().toISOString();
    const eventId = randomUUID();
    const nextTranscript = transcriptSchema.parse({
      ...input.transcript,
      status: 'APPROVED',
      approvedVersion: input.transcript.version,
      approvedBy: input.actorId,
      approvedAt: now,
      updatedAt: now,
    });
    const handoff: TranscriptApprovalHandoff = {
      transcriptId: input.transcript.transcriptId,
      meetingId: input.transcript.meetingId,
      groupId: input.transcript.groupId,
      approvedVersion: input.transcript.version,
      artifactObjectKey: input.artifactObjectKey,
      artifactChecksum: input.artifactChecksum,
      aiJobId: input.preparedJob.aiJobId,
      aiOperation: 'INGEST_SOURCE',
      aiJobType: 'INGEST_SOURCE',
      createdAt: now,
      updatedAt: now,
    };
    const intentKey = approvalIntentKey(input.actorId, input.idempotencyKey);
    try {
      await this.database.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Put: {
                TableName: this.meetingTable,
                Item: {
                  PK: `TRANSCRIPT#${input.transcript.transcriptId}`,
                  SK: 'META',
                  entityType: 'TRANSCRIPT',
                  ...nextTranscript,
                },
                ConditionExpression:
                  '#version = :version AND #status = :ready AND meetingId = :meetingId AND groupId = :groupId',
                ExpressionAttributeNames: { '#version': 'version', '#status': 'status' },
                ExpressionAttributeValues: {
                  ':version': input.transcript.version,
                  ':ready': 'READY',
                  ':meetingId': input.transcript.meetingId,
                  ':groupId': input.transcript.groupId,
                },
              },
            },
            {
              Put: {
                TableName: this.meetingTable,
                Item: {
                  PK: `TRANSCRIPT#${input.transcript.transcriptId}`,
                  SK: `APPROVAL#${now}#${eventId}`,
                  entityType: 'TRANSCRIPT_APPROVAL',
                  eventId,
                  transcriptId: input.transcript.transcriptId,
                  meetingId: input.transcript.meetingId,
                  groupId: input.transcript.groupId,
                  approvedVersion: input.transcript.version,
                  actorId: input.actorId,
                  requestId: input.requestId,
                  handoffKey: transcriptApprovalHandoffKey(input.transcript.version),
                  aiJobId: input.preparedJob.aiJobId,
                  artifactObjectKey: input.artifactObjectKey,
                  artifactChecksum: input.artifactChecksum,
                  createdAt: now,
                },
                ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
              },
            },
            {
              Put: {
                TableName: this.meetingTable,
                Item: {
                  PK: `TRANSCRIPT#${input.transcript.transcriptId}`,
                  SK: transcriptApprovalHandoffKey(input.transcript.version),
                  entityType: 'TRANSCRIPT_APPROVAL_HANDOFF',
                  ...handoff,
                },
                ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
              },
            },
            input.preparedJob.persistenceContribution,
            {
              Put: {
                TableName: this.meetingTable,
                Item: {
                  ...intentKey,
                  entityType: 'TRANSCRIPT_APPROVAL_IDEMPOTENCY',
                  transcriptId: input.transcript.transcriptId,
                  expectedVersion: input.request.expectedVersion,
                  aiJobId: input.preparedJob.aiJobId,
                  createdAt: now,
                },
                ConditionExpression: 'attribute_not_exists(PK)',
              },
            },
          ],
        }),
      );
      return { transcript: nextTranscript, handoff, created: true };
    } catch (error) {
      if ((error as { name?: string }).name !== 'TransactionCanceledException') throw error;
      const intent = await this.getApprovalIntent(input.actorId, input.idempotencyKey);
      if (
        intent &&
        (intent.transcriptId !== input.transcript.transcriptId ||
          intent.expectedVersion !== input.request.expectedVersion)
      )
        throw new ConflictError('Idempotency-Key đã được dùng cho một yêu cầu duyệt khác.');
      const [current, existingHandoff] = await Promise.all([
        this.getById(input.transcript.transcriptId),
        this.getApprovalHandoff(input.transcript.transcriptId, input.transcript.version),
      ]);
      if (
        current?.status === 'APPROVED' &&
        current.approvedVersion === input.transcript.version &&
        existingHandoff
      ) {
        await this.bindApprovalIntent({
          actorId: input.actorId,
          idempotencyKey: input.idempotencyKey,
          transcriptId: input.transcript.transcriptId,
          expectedVersion: input.request.expectedVersion,
          aiJobId: existingHandoff.aiJobId,
        });
        return { transcript: current, handoff: existingHandoff, created: false };
      }
      if (current && current.version !== input.transcript.version)
        throw new ConflictError('Transcript đã được cập nhật bởi yêu cầu khác.');
      if (current && current.status !== 'READY')
        throw new UnprocessableEntityError('Transcript chưa sẵn sàng để duyệt.');
      throw error;
    }
  }
  async getCanonical(meetingId: string, groupId: string, limit: number, cursor?: string) {
    const refs = await this.database.send(
      new QueryCommand({
        TableName: this.meetingTable,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: { ':pk': `MEETING#${meetingId}`, ':prefix': 'TRANSCRIPT#' },
        ScanIndexForward: false,
        Limit: 1,
        ConsistentRead: true,
      }),
    );
    if (!refs.Items?.length) return { transcript: null, segments: [] };
    const ref = refs.Items[0]!;
    const match = /^TRANSCRIPT#(\d{10})#(.+)$/.exec(String(ref.SK ?? ''));
    if (
      !match ||
      ref.PK !== `MEETING#${meetingId}` ||
      ref.entityType !== 'TRANSCRIPT_REFERENCE' ||
      ref.meetingId !== meetingId ||
      ref.groupId !== groupId ||
      ref.transcriptId !== match[2] ||
      ref.version !== Number(match[1])
    )
      throw new Error('TRANSCRIPT_DATA_INTEGRITY');
    const transcript = await this.getById(match[2]!);
    if (
      !transcript ||
      transcript.meetingId !== meetingId ||
      transcript.groupId !== groupId ||
      transcript.version !== ref.version
    )
      throw new Error('TRANSCRIPT_DATA_INTEGRITY');
    const start = decodeTranscriptCursor(meetingId, transcript.transcriptId, cursor);
    const page = await this.database.send(
      new QueryCommand({
        TableName: this.meetingTable,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: {
          ':pk': `TRANSCRIPT#${transcript.transcriptId}`,
          ':prefix': 'SEGMENT#',
        },
        ...(start ? { ExclusiveStartKey: start } : {}),
        Limit: limit,
        ConsistentRead: true,
      }),
    );
    const segments = (page.Items ?? []).map((item) => parseSegment(item, transcript.transcriptId));
    const nextCursor = encodeTranscriptCursor(
      meetingId,
      transcript.transcriptId,
      page.LastEvaluatedKey,
    );
    if (nextCursor && cursor === nextCursor) integrity();
    return transcriptWithSegmentsSchema.parse({
      transcript,
      segments,
      ...(nextCursor ? { nextCursor } : {}),
    });
  }
  async updateSegment({
    transcript,
    segmentId,
    actorId,
    update,
  }: Parameters<TranscriptRepository['updateSegment']>[0]) {
    if (transcript.version >= MAX_TRANSCRIPT_VERSION)
      throw new ConflictError('Transcript đã đạt giới hạn phiên bản.');
    let segment: TranscriptSegment | undefined;
    let exclusiveStartKey: DynamoItem | undefined;
    const seenKeys = new Set<string>();
    do {
      const segmentResult = await this.database.send(
        new QueryCommand({
          TableName: this.meetingTable,
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
          ExpressionAttributeValues: {
            ':pk': `TRANSCRIPT#${transcript.transcriptId}`,
            ':prefix': 'SEGMENT#',
          },
          ...(exclusiveStartKey ? { ExclusiveStartKey: exclusiveStartKey } : {}),
          ConsistentRead: true,
        }),
      );
      for (const item of segmentResult.Items ?? []) {
        const parsed = parseSegment(item, transcript.transcriptId);
        if (parsed.segmentId === segmentId) {
          segment = parsed;
          break;
        }
      }
      if (segment) break;
      exclusiveStartKey = segmentResult.LastEvaluatedKey;
      if (exclusiveStartKey) {
        const serialized = JSON.stringify(exclusiveStartKey);
        if (seenKeys.has(serialized)) throw new Error('TRANSCRIPT_DATA_INTEGRITY');
        seenKeys.add(serialized);
      }
    } while (exclusiveStartKey);
    if (!segment) throw new ResourceNotFoundError('Không tìm thấy đoạn transcript.');
    const nextVersion = transcript.version + 1;
    const now = new Date().toISOString();
    const eventId = randomUUID();
    const changedFields = (['text', 'speakerLabel', 'languageCode'] as const).filter(
      (field) => update[field] !== undefined && update[field] !== segment[field],
    );
    const nextTranscript = transcriptSchema.parse({
      ...transcript,
      version: nextVersion,
      status: transcript.status === 'APPROVED' ? 'READY' : transcript.status,
      updatedAt: now,
    });
    const nextSegment = transcriptSegmentSchema.parse({
      ...segment,
      ...Object.fromEntries(
        (['text', 'speakerLabel', 'languageCode'] as const)
          .filter((k) => update[k] !== undefined)
          .map((k) => [k, update[k]]),
      ),
      version: nextVersion,
      updatedBy: actorId,
      updatedAt: now,
    });
    const ref = {
      PK: `MEETING#${transcript.meetingId}`,
      SK: transcriptReferenceKey(nextVersion, transcript.transcriptId),
      entityType: 'TRANSCRIPT_REFERENCE',
      meetingId: transcript.meetingId,
      groupId: transcript.groupId,
      transcriptId: transcript.transcriptId,
      version: nextVersion,
      createdAt: now,
    };
    try {
      await this.database.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Put: {
                TableName: this.meetingTable,
                Item: {
                  PK: `TRANSCRIPT#${transcript.transcriptId}`,
                  SK: 'META',
                  entityType: 'TRANSCRIPT',
                  ...nextTranscript,
                },
                ConditionExpression:
                  '#version = :old AND #status IN (:ready, :approved) AND meetingId = :meetingId AND groupId = :groupId',
                ExpressionAttributeNames: { '#version': 'version', '#status': 'status' },
                ExpressionAttributeValues: {
                  ':old': transcript.version,
                  ':ready': 'READY',
                  ':approved': 'APPROVED',
                  ':meetingId': transcript.meetingId,
                  ':groupId': transcript.groupId,
                },
              },
            },
            {
              Put: {
                TableName: this.meetingTable,
                Item: {
                  PK: `TRANSCRIPT#${transcript.transcriptId}`,
                  SK: transcriptSegmentKey(segment.sequence, segment.segmentId),
                  entityType: 'TRANSCRIPT_SEGMENT',
                  ...nextSegment,
                },
                ConditionExpression:
                  'attribute_exists(PK) AND transcriptId = :transcriptId AND segmentId = :segmentId AND #version <= :old',
                ExpressionAttributeNames: { '#version': 'version' },
                ExpressionAttributeValues: {
                  ':transcriptId': transcript.transcriptId,
                  ':segmentId': segmentId,
                  ':old': transcript.version,
                },
              },
            },
            {
              Put: {
                TableName: this.meetingTable,
                Item: {
                  PK: `TRANSCRIPT#${transcript.transcriptId}`,
                  SK: `EDIT#${now}#${eventId}`,
                  entityType: 'TRANSCRIPT_EDIT',
                  eventId,
                  transcriptId: transcript.transcriptId,
                  segmentId,
                  meetingId: transcript.meetingId,
                  groupId: transcript.groupId,
                  actorId,
                  beforeVersion: transcript.version,
                  afterVersion: nextVersion,
                  changedFields,
                  createdAt: now,
                },
                ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
              },
            },
            {
              Put: {
                TableName: this.meetingTable,
                Item: ref,
                ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
              },
            },
          ],
        }),
      );
    } catch (error) {
      if ((error as { name?: string }).name !== 'TransactionCanceledException') throw error;
      const current = await this.getById(transcript.transcriptId);
      if (
        current &&
        (current.version !== transcript.version || !['READY', 'APPROVED'].includes(current.status))
      )
        throw new ConflictError('Transcript đã được cập nhật bởi yêu cầu khác.');
      throw error;
    }
    return { transcript: nextTranscript, segment: nextSegment };
  }
}
