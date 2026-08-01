import { type DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { ApprovedSourceReader, SourceChunk } from '../domain/ports';

interface TranscriptReference {
  transcriptId?: string;
  version?: number;
  approved?: boolean;
  approvedVersion?: number;
  groupId?: string;
}

interface SegmentRecord {
  segmentId?: string;
  sequence?: number;
  text?: string;
  isFinal?: boolean;
  speakerLabel?: string;
  startMs?: number;
  endMs?: number;
}

export class DynamoApprovedSourceReader implements ApprovedSourceReader {
  constructor(
    private readonly database: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  async getFinalLiveSegments(meetingId: string, groupId: string): Promise<SourceChunk[]> {
    const references = await this.database.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: {
          ':pk': `MEETING#${meetingId}`,
          ':prefix': 'TRANSCRIPT#',
        },
        ScanIndexForward: false,
      }),
    );
    const transcript = (references.Items as TranscriptReference[] | undefined)?.find(
      (item) => item.transcriptId && (!item.groupId || item.groupId === groupId),
    );
    if (!transcript?.transcriptId) return [];
    const response = await this.database.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: {
          ':pk': `TRANSCRIPT#${transcript.transcriptId}`,
          ':prefix': 'SEGMENT#',
        },
      }),
    );
    const version = transcript.approvedVersion ?? transcript.version ?? 1;
    return ((response.Items ?? []) as SegmentRecord[])
      .filter(
        (segment): segment is SegmentRecord & { segmentId: string; text: string } =>
          segment.isFinal === true && Boolean(segment.segmentId && segment.text?.trim()),
      )
      .map((segment, index) => ({
        text: segment.text,
        citation: {
          citationId: `live-${transcript.transcriptId}-${segment.segmentId}`,
          groupId,
          meetingId,
          sourceType: 'TRANSCRIPT' as const,
          sourceId: transcript.transcriptId!,
          sourceVersion: version,
          segmentId: segment.segmentId,
          ...(segment.speakerLabel ? { speakerLabel: segment.speakerLabel } : {}),
          ...(segment.startMs === undefined ? {} : { startMs: segment.startMs }),
          ...(segment.endMs === undefined ? {} : { endMs: segment.endMs }),
          excerpt: segment.text.slice(0, 500),
          internalUri: `campusmeet://meetings/${meetingId}/transcripts/${transcript.transcriptId}/segments/${segment.segmentId}`,
        },
        provenance: { kind: 'LIVE_TRANSCRIPT' as const, isFinal: true },
        sequence: segment.sequence ?? index,
      }))
      .sort((left, right) => left.sequence - right.sequence)
      .map(({ sequence: _sequence, ...chunk }) => chunk);
  }
}
