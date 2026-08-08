import { randomUUID } from 'node:crypto';
import {
  GetCommand,
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
import type { TranscriptRepository } from '../domain/transcript-ports';
import { BadRequestError, ConflictError, ResourceNotFoundError } from '../utils/errors';
import { documentClient, tableName, type DynamoItem } from './client';

const integrity = (): never => {
  throw new Error('TRANSCRIPT_DATA_INTEGRITY');
};
export const transcriptReferenceKey = (version: number, transcriptId: string) =>
  `TRANSCRIPT#${String(version).padStart(TRANSCRIPT_VERSION_PADDING, '0')}#${transcriptId}`;
export const transcriptSegmentKey = (sequence: number, segmentId: string) =>
  `SEGMENT#${String(sequence).padStart(TRANSCRIPT_SEQUENCE_PADDING, '0')}#${segmentId}`;
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
