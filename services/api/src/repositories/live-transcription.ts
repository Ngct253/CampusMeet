import { createHash } from 'node:crypto';
import { GetCommand, PutCommand, QueryCommand, TransactWriteCommand, UpdateCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import {
  consentSchema, liveSessionSchema, recordingSchema, transcriptSchema, transcriptSegmentSchema,
  type Consent, type FinalTranscriptSegmentRequest, type GapMetadata, type LiveSession,
  type LiveSessionStatus, type Recording, type TranscriptSegment,
} from '@campusmeet/shared';
import type { LiveTranscriptionRepository } from '../domain/live-transcription-ports';
import { ConflictError } from '../utils/errors';
import { documentClient, tableName, type DynamoItem } from './client';
import { DynamoDbTranscriptRepository, transcriptReferenceKey, transcriptSegmentKey } from './transcripts';

const digest = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 32);
const sessionKey = (meetingId: string, sessionId: string) => ({ PK: `MEETING#${meetingId}`, SK: `LIVE_SESSION#${sessionId}` });
const recordingKey = (meetingId: string, createdAt: string, recordingId: string) => ({ PK: `MEETING#${meetingId}`, SK: `RECORDING#${createdAt}#${recordingId}` });

const parseRecording = (item: DynamoItem): Recording => recordingSchema.parse({
  recordingId: item.recordingId, meetingId: item.meetingId, groupId: item.groupId,
  consentId: item.consentId, captureSource: item.captureSource, status: item.status,
  objectKey: item.objectKey, contentType: item.contentType, sizeBytes: item.sizeBytes,
  checksum: item.checksum, durationMs: item.durationMs, createdBy: item.createdBy,
  createdAt: item.createdAt, updatedAt: item.updatedAt, retentionUntil: item.retentionUntil,
});
const parseConsent = (item: DynamoItem): Consent => consentSchema.parse({
  consentId: item.consentId, meetingId: item.meetingId, recordingId: item.recordingId,
  actorId: item.actorId, decision: item.decision, noticeVersion: item.noticeVersion,
  captureSource: item.captureSource, consentedAt: item.consentedAt, retentionUntil: item.retentionUntil,
});
const parseSession = (item: DynamoItem): LiveSession => liveSessionSchema.parse({
  sessionId: item.sessionId, meetingId: item.meetingId, groupId: item.groupId,
  transcriptId: item.transcriptId, recordingId: item.recordingId, consentId: item.consentId,
  startedBy: item.startedBy, captureSource: item.captureSource, languageCode: item.languageCode,
  status: item.status, lastAcceptedSequence: item.lastAcceptedSequence,
  lastHeartbeatAt: item.lastHeartbeatAt, heartbeatExpiresAt: item.heartbeatExpiresAt,
  startedAt: item.startedAt, updatedAt: item.updatedAt, failureCode: item.failureCode,
});
const parseCanonicalSegment = (item: DynamoItem): TranscriptSegment => transcriptSegmentSchema.parse({
  segmentId: item.segmentId, transcriptId: item.transcriptId, sequence: item.sequence,
  startMs: item.startMs, endMs: item.endMs, text: item.text, confidence: item.confidence,
  languageCode: item.languageCode, speakerLabel: item.speakerLabel, isFinal: item.isFinal,
  version: item.version, updatedBy: item.updatedBy, updatedAt: item.updatedAt,
});

export class DynamoDbLiveTranscriptionRepository implements LiveTranscriptionRepository {
  constructor(private readonly client: DynamoDBDocumentClient = documentClient) {}
  private table() { return tableName('MEETING_DATA_TABLE'); }

  async createRecording(input: Parameters<LiveTranscriptionRepository['createRecording']>[0]) {
    const recordingId = digest(`${input.actorId}:${input.requestId}`);
    const consentId = digest(`${recordingId}:consent:${input.request.consentNoticeVersion}`);
    const recording = recordingSchema.parse({
      recordingId, meetingId: input.meetingId, groupId: input.groupId, consentId,
      captureSource: input.request.captureSource, status: 'CONSENTED', objectKey: input.objectKey,
      contentType: input.request.contentType, createdBy: input.actorId, createdAt: input.now,
      updatedAt: input.now, retentionUntil: input.retentionUntil,
    });
    const consent = consentSchema.parse({
      consentId, meetingId: input.meetingId, recordingId, actorId: input.actorId,
      decision: 'ACCEPTED', noticeVersion: input.request.consentNoticeVersion,
      captureSource: input.request.captureSource, consentedAt: input.now, retentionUntil: input.retentionUntil,
    });
    const meetingRecord = { ...recordingKey(input.meetingId, input.now, recordingId), entityType: 'RECORDING', ...recording };
    const meta = { PK: `RECORDING#${recordingId}`, SK: 'META', entityType: 'RECORDING', ...recording };
    const consentItem = { PK: `RECORDING#${recordingId}`, SK: `CONSENT#${input.actorId}#${consentId}`, entityType: 'RECORDING_CONSENT', ...consent };
    try {
      await this.client.send(new TransactWriteCommand({ TransactItems: [meetingRecord, meta, consentItem].map((Item) => ({ Put: { TableName: this.table(), Item, ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)' } })) }));
    } catch (error) {
      const existing = await this.client.send(new GetCommand({ TableName: this.table(), Key: { PK: `RECORDING#${recordingId}`, SK: 'META' } }));
      const consentResult = await this.client.send(new GetCommand({ TableName: this.table(), Key: { PK: `RECORDING#${recordingId}`, SK: `CONSENT#${input.actorId}#${consentId}` } }));
      if (!existing.Item || !consentResult.Item) throw error;
      return { recording: parseRecording(existing.Item), consent: parseConsent(consentResult.Item) };
    }
    return { recording, consent };
  }

  async prepareRecordingUpload(input: Parameters<LiveTranscriptionRepository['prepareRecordingUpload']>[0]) {
    try {
      const result = await this.client.send(new UpdateCommand({
        TableName: this.table(), Key: { PK: `RECORDING#${input.recordingId}`, SK: 'META' },
        UpdateExpression: 'SET #status = :pending, sizeBytes = :size, checksum = :checksum, durationMs = :duration, updatedAt = :now',
        ConditionExpression: 'createdBy = :actor AND (#status = :consented OR (#status = :pending AND sizeBytes = :size AND checksum = :checksum AND durationMs = :duration))',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: { ':pending': 'PENDING_UPLOAD', ':consented': 'CONSENTED', ':size': input.request.sizeBytes, ':checksum': input.request.checksum, ':duration': input.request.durationMs, ':now': input.now, ':actor': input.actorId },
        ReturnValues: 'ALL_NEW',
      }));
      return parseRecording(result.Attributes!);
    } catch { throw new ConflictError('Recording upload metadata conflicts with the existing intent.'); }
  }

  async getRecording(recordingId: string) {
    const result = await this.client.send(new GetCommand({ TableName: this.table(), Key: { PK: `RECORDING#${recordingId}`, SK: 'META' } }));
    return result.Item ? parseRecording(result.Item) : null;
  }

  async completeRecording(input: Parameters<LiveTranscriptionRepository['completeRecording']>[0]) {
    try {
      const result = await this.client.send(new UpdateCommand({
        TableName: this.table(), Key: { PK: `RECORDING#${input.recording.recordingId}`, SK: 'META' },
        UpdateExpression: 'SET #status = :ready, updatedAt = :now',
        ConditionExpression: 'createdBy = :actor AND (#status = :pending OR #status = :ready) AND sizeBytes = :size AND checksum = :checksum',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: { ':ready': 'READY', ':pending': 'PENDING_UPLOAD', ':actor': input.actorId, ':size': input.recording.sizeBytes, ':checksum': input.recording.checksum, ':now': input.now },
        ReturnValues: 'ALL_NEW',
      }));
      return parseRecording(result.Attributes!);
    } catch { throw new ConflictError('Recording cannot be completed from its current state.'); }
  }

  async findAcceptedConsent(meetingId: string, actorId: string) {
    const result = await this.client.send(new QueryCommand({ TableName: this.table(), KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)', ExpressionAttributeValues: { ':pk': `MEETING#${meetingId}`, ':prefix': 'RECORDING#' }, ScanIndexForward: false, Limit: 25 }));
    for (const item of result.Items ?? []) {
      const recording = parseRecording(item);
      if (recording.createdBy !== actorId) continue;
      const consents = await this.client.send(new QueryCommand({ TableName: this.table(), KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)', ExpressionAttributeValues: { ':pk': `RECORDING#${recording.recordingId}`, ':prefix': `CONSENT#${actorId}#` }, ScanIndexForward: false, Limit: 1 }));
      if (consents.Items?.[0]) {
        const consent = parseConsent(consents.Items[0]);
        if (consent.decision === 'ACCEPTED' && Date.parse(consent.retentionUntil) > Date.now()) return { recording, consent };
      }
    }
    return null;
  }

  async getSession(meetingId: string, sessionId: string) {
    const result = await this.client.send(new GetCommand({ TableName: this.table(), Key: sessionKey(meetingId, sessionId) }));
    return result.Item ? parseSession(result.Item) : null;
  }

  async getTranscript(transcriptId: string) {
    return new DynamoDbTranscriptRepository(this.client).getById(transcriptId);
  }

  async createSession(input: Parameters<LiveTranscriptionRepository['createSession']>[0]) {
    const sessionId = digest(`${input.actorId}:${input.requestId}`);
    const transcriptId = digest(`canonical-transcript:${input.meetingId}`);
    const transcriptRepo = new DynamoDbTranscriptRepository(this.client);
    const existingTranscript = await transcriptRepo.getById(transcriptId);
    const transcript = existingTranscript ?? transcriptSchema.parse({ transcriptId, meetingId: input.meetingId, groupId: input.groupId, status: 'LIVE', version: 1, createdAt: input.now, updatedAt: input.now });
    if (transcript.status !== 'LIVE') throw new ConflictError('Canonical transcript is already terminal or ready for M3.');
    const session = liveSessionSchema.parse({ sessionId, meetingId: input.meetingId, groupId: input.groupId, transcriptId, recordingId: input.recording.recordingId, consentId: input.consent.consentId, startedBy: input.actorId, captureSource: input.recording.captureSource, languageCode: input.languageCode, status: 'ACTIVE', lastAcceptedSequence: -1, lastHeartbeatAt: input.now, heartbeatExpiresAt: input.heartbeatExpiresAt, startedAt: input.now, updatedAt: input.now });
    const items: NonNullable<ConstructorParameters<typeof TransactWriteCommand>[0]>['TransactItems'] = [
      { Put: { TableName: this.table(), Item: { ...sessionKey(input.meetingId, sessionId), entityType: 'LIVE_SESSION', ...session }, ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)' } },
      { Put: { TableName: this.table(), Item: { PK: `MEETING#${input.meetingId}`, SK: 'LIVE_SESSION#ACTIVE', entityType: 'LIVE_SESSION_POINTER', sessionId }, ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)' } },
    ];
    if (!existingTranscript) items.push(
      { Put: { TableName: this.table(), Item: { PK: `TRANSCRIPT#${transcriptId}`, SK: 'META', entityType: 'TRANSCRIPT', ...transcript }, ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)' } },
      { Put: { TableName: this.table(), Item: { PK: `MEETING#${input.meetingId}`, SK: transcriptReferenceKey(1, transcriptId), entityType: 'TRANSCRIPT_REFERENCE', transcriptId, meetingId: input.meetingId, groupId: input.groupId, version: 1 }, ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)' } },
    );
    try { await this.client.send(new TransactWriteCommand({ TransactItems: items })); }
    catch (error) {
      const replay = await this.getSession(input.meetingId, sessionId);
      if (replay) return { session: replay, transcript: (await transcriptRepo.getById(replay.transcriptId))! };
      throw error;
    }
    return { session, transcript };
  }

  async transitionSession(input: { session: LiveSession; from: LiveSessionStatus[]; to: LiveSessionStatus; now: string; heartbeatExpiresAt?: string; failureCode?: string }) {
    const values: Record<string, unknown> = { ':to': input.to, ':now': input.now, ':meetingId': input.session.meetingId, ':sessionId': input.session.sessionId };
    const names: Record<string, string> = { '#status': 'status' };
    const allowed = input.from.map((state, index) => { values[`:from${index}`] = state; return `:from${index}`; });
    let update = 'SET #status = :to, updatedAt = :now';
    if (input.heartbeatExpiresAt) { values[':expires'] = input.heartbeatExpiresAt; update += ', lastHeartbeatAt = :now, heartbeatExpiresAt = :expires'; }
    if (input.failureCode) { values[':failure'] = input.failureCode; update += ', failureCode = :failure'; }
    try {
      const result = await this.client.send(new UpdateCommand({ TableName: this.table(), Key: sessionKey(input.session.meetingId, input.session.sessionId), UpdateExpression: update, ConditionExpression: `meetingId = :meetingId AND sessionId = :sessionId AND #status IN (${allowed.join(',')})`, ExpressionAttributeNames: names, ExpressionAttributeValues: values, ReturnValues: 'ALL_NEW' }));
      return parseSession(result.Attributes!);
    } catch { throw new ConflictError('Live session state changed concurrently.'); }
  }

  async appendFinalSegments(input: { session: LiveSession; segments: FinalTranscriptSegmentRequest[]; now: string }) {
    let session = input.session;
    const persisted: TranscriptSegment[] = [];
    for (const segment of [...input.segments].sort((a, b) => a.sequence - b.sequence)) {
      const segmentId = digest(`${session.sessionId}:${segment.resultId}`);
      const canonical = transcriptSegmentSchema.parse({
        segmentId, transcriptId: session.transcriptId, sequence: segment.sequence,
        startMs: segment.startMs, endMs: segment.endMs, text: segment.text,
        confidence: segment.confidence, languageCode: segment.languageCode,
        speakerLabel: segment.speakerLabel, isFinal: segment.isFinal, version: 1,
      });
      const key = { PK: `TRANSCRIPT#${session.transcriptId}`, SK: transcriptSegmentKey(segment.sequence, segmentId) };
      if (segment.sequence <= session.lastAcceptedSequence) {
        const replay = await this.client.send(new GetCommand({ TableName: this.table(), Key: key }));
        if (!replay.Item || replay.Item.resultId !== segment.resultId || replay.Item.sessionId !== session.sessionId) throw new ConflictError('Sequence was already used by another final result.');
        persisted.push(parseCanonicalSegment(replay.Item));
        continue;
      }
      if (segment.sequence !== session.lastAcceptedSequence + 1) throw new ConflictError('Final segment sequence is not contiguous.');
      await this.client.send(new TransactWriteCommand({ TransactItems: [
        { Put: { TableName: this.table(), Item: { ...key, entityType: 'TRANSCRIPT_SEGMENT', ...canonical, resultId: segment.resultId, sessionId: session.sessionId }, ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)' } },
        { Update: { TableName: this.table(), Key: sessionKey(session.meetingId, session.sessionId), UpdateExpression: 'SET lastAcceptedSequence = :next, updatedAt = :now', ConditionExpression: '#status = :active AND lastAcceptedSequence = :previous', ExpressionAttributeNames: { '#status': 'status' }, ExpressionAttributeValues: { ':active': 'ACTIVE', ':previous': session.lastAcceptedSequence, ':next': segment.sequence, ':now': input.now } } },
      ] }));
      session = liveSessionSchema.parse({ ...session, lastAcceptedSequence: segment.sequence, updatedAt: input.now });
      persisted.push(canonical);
    }
    return { session, segments: persisted };
  }

  async putGap(input: Parameters<LiveTranscriptionRepository['putGap']>[0]) {
    const gapId = digest(`${input.session.sessionId}:${input.gap.fromSequence}:${input.gap.toSequence}`);
    const gap = { ...input.gap, gapId, sessionId: input.session.sessionId, meetingId: input.session.meetingId, createdAt: input.now } as GapMetadata;
    await this.client.send(new PutCommand({ TableName: this.table(), Item: { PK: `LIVE_SESSION#${input.session.sessionId}`, SK: `GAP#${String(input.gap.fromSequence).padStart(10, '0')}#${gapId}`, entityType: 'LIVE_TRANSCRIPTION_GAP', ...gap }, ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)' })).catch(async (error) => {
      const existing = await this.client.send(new GetCommand({ TableName: this.table(), Key: { PK: `LIVE_SESSION#${input.session.sessionId}`, SK: `GAP#${String(input.gap.fromSequence).padStart(10, '0')}#${gapId}` } }));
      if (!existing.Item) throw error;
    });
    return gap;
  }

  async finalize(input: Parameters<LiveTranscriptionRepository['finalize']>[0]) {
    const sessionStatus = input.failed ? 'FAILED' : 'STOPPED';
    const transcriptStatus = input.failed ? 'FAILED' : 'FINALIZING';
    const sessionValues: Record<string, unknown> = { ':sessionStatus': sessionStatus, ':now': input.now, ':active': 'ACTIVE', ':reconnecting': 'RECONNECTING' };
    if (input.failureCode) sessionValues[':failure'] = input.failureCode;
    const transcriptValues = { ':transcriptStatus': transcriptStatus, ':now': input.now, ':live': 'LIVE', ':finalizing': 'FINALIZING' };
    await this.client.send(new TransactWriteCommand({ TransactItems: [
      { Update: { TableName: this.table(), Key: sessionKey(input.session.meetingId, input.session.sessionId), UpdateExpression: `SET #status = :sessionStatus, updatedAt = :now${input.failureCode ? ', failureCode = :failure' : ''}`, ConditionExpression: '#status IN (:active, :reconnecting)', ExpressionAttributeNames: { '#status': 'status' }, ExpressionAttributeValues: sessionValues } },
      { Update: { TableName: this.table(), Key: { PK: `TRANSCRIPT#${input.session.transcriptId}`, SK: 'META' }, UpdateExpression: 'SET #status = :transcriptStatus, updatedAt = :now', ConditionExpression: '#status IN (:live, :finalizing)', ExpressionAttributeNames: { '#status': 'status' }, ExpressionAttributeValues: transcriptValues } },
      { Delete: { TableName: this.table(), Key: { PK: `MEETING#${input.session.meetingId}`, SK: 'LIVE_SESSION#ACTIVE' }, ConditionExpression: 'sessionId = :sessionId', ExpressionAttributeValues: { ':sessionId': input.session.sessionId } } },
    ] }));
    if (!input.failed) await this.client.send(new UpdateCommand({ TableName: this.table(), Key: { PK: `TRANSCRIPT#${input.session.transcriptId}`, SK: 'META' }, UpdateExpression: 'SET #status = :ready, updatedAt = :now', ConditionExpression: '#status = :finalizing', ExpressionAttributeNames: { '#status': 'status' }, ExpressionAttributeValues: { ':ready': 'READY', ':finalizing': 'FINALIZING', ':now': input.now } }));
    const transcript = await new DynamoDbTranscriptRepository(this.client).getById(input.session.transcriptId);
    return { session: liveSessionSchema.parse({ ...input.session, status: sessionStatus, updatedAt: input.now, ...(input.failureCode ? { failureCode: input.failureCode } : {}) }), transcript: transcript! };
  }
}
