import { createHash } from 'node:crypto';
import {
  GroupRole, MeetingStatus, createRecordingResponseSchema, finalizeLiveSessionResponseSchema,
  heartbeatResponseSchema, prepareRecordingUploadResponseSchema, reconnectResponseSchema, startLiveSessionResponseSchema,
  type AppendFinalSegmentsRequest, type CreateRecordingRequest, type FinalizeLiveSessionRequest,
  type PrepareRecordingUploadRequest, type StartLiveSessionRequest,
} from '@campusmeet/shared';
import type { LiveConnectionSigner, LiveTranscriptionRepository, RecordingUploadSigner } from '../domain/live-transcription-ports';
import type { DynamoDbCollaborationRepository } from '../repositories/collaboration';
import type { DynamoDbMeetingRepository } from '../repositories/dynamodb';
import { ConflictError, ForbiddenError, ResourceNotFoundError, ServiceConfigurationError, UnprocessableEntityError } from '../utils/errors';

type Meetings = Pick<DynamoDbMeetingRepository, 'getById'>;
type Memberships = Pick<DynamoDbCollaborationRepository, 'getMembership'>;
const HEARTBEAT_TTL_MS = 45_000;
const RECORDING_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const supportedLanguages = () => new Set((process.env.TRANSCRIBE_LANGUAGE_ALLOWLIST ?? 'vi-VN,en-US').split(',').map((value) => value.trim()).filter(Boolean));

export class LiveTranscriptionService {
  constructor(
    private readonly repository: LiveTranscriptionRepository,
    private readonly meetings: Meetings,
    private readonly memberships: Memberships,
    private readonly connections: LiveConnectionSigner,
    private readonly uploads: RecordingUploadSigner,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private async context(actorId: string, meetingId: string, mutation: boolean) {
    const meeting = await this.meetings.getById(meetingId);
    if (!meeting) throw new ResourceNotFoundError('Meeting was not found.');
    const membership = await this.memberships.getMembership(meeting.groupId, actorId);
    if (!membership?.active) throw new ForbiddenError('Active group membership is required.');
    if (mutation && meeting.organizerId !== actorId && membership.role !== GroupRole.GROUP_ADMIN)
      throw new ForbiddenError('Only the organizer or an active Group Admin may control live capture.');
    return { meeting, membership };
  }

  private async authorizedSession(actorId: string, meetingId: string, sessionId: string, mutation = true) {
    await this.context(actorId, meetingId, mutation);
    const session = await this.repository.getSession(meetingId, sessionId);
    if (!session || session.meetingId !== meetingId) throw new ResourceNotFoundError('Live session was not found.');
    if (Date.parse(session.heartbeatExpiresAt) <= this.now().getTime() && ['ACTIVE', 'RECONNECTING'].includes(session.status)) {
      return (await this.repository.finalize({ session, failed: true, failureCode: 'HEARTBEAT_EXPIRED', now: this.now().toISOString() })).session;
    }
    return session;
  }

  async createRecording(actorId: string, meetingId: string, requestId: string, request: CreateRecordingRequest) {
    const { meeting } = await this.context(actorId, meetingId, true);
    if (meeting.status === MeetingStatus.CANCELLED || meeting.status === MeetingStatus.COMPLETED)
      throw new UnprocessableEntityError('This meeting cannot start a recording.');
    const id = createHash('sha256').update(`${actorId}:${requestId}`).digest('hex').slice(0, 32);
    const extension = request.contentType === 'audio/wav' ? 'wav' : 'webm';
    const objectKey = `uploads/${meeting.groupId}/${meeting.id}/recordings/${id}/audio.${extension}`;
    const now = this.now();
    const retentionUntil = new Date(now.getTime() + RECORDING_RETENTION_MS).toISOString();
    const stored = await this.repository.createRecording({ meetingId, groupId: meeting.groupId, actorId, requestId, request, objectKey, now: now.toISOString(), retentionUntil });
    return createRecordingResponseSchema.parse(stored);
  }

  async prepareRecordingUpload(actorId: string, meetingId: string, recordingId: string, request: PrepareRecordingUploadRequest) {
    await this.context(actorId, meetingId, true);
    const now = this.now();
    const recording = await this.repository.prepareRecordingUpload({ recordingId, actorId, request, now: now.toISOString() });
    if (recording.meetingId !== meetingId) throw new ForbiddenError('Recording does not belong to this meeting.');
    const uploadUrl = await this.uploads.createUploadUrl({ objectKey: recording.objectKey, contentType: recording.contentType, checksum: request.checksum });
    return prepareRecordingUploadResponseSchema.parse({ recording, uploadUrl, uploadExpiresAt: new Date(now.getTime() + 300_000).toISOString() });
  }

  async completeRecording(actorId: string, meetingId: string, recordingId: string) {
    await this.context(actorId, meetingId, true);
    const recording = await this.repository.getRecording(recordingId);
    if (!recording || recording.meetingId !== meetingId) throw new ResourceNotFoundError('Recording was not found.');
    if (!recording.sizeBytes || !recording.checksum) throw new UnprocessableEntityError('Recording upload metadata is incomplete.');
    const object = await this.uploads.head(recording.objectKey);
    if (object.sizeBytes !== recording.sizeBytes || object.contentType !== recording.contentType || object.checksum !== recording.checksum)
      throw new UnprocessableEntityError('Uploaded recording metadata does not match the recording intent.');
    return this.repository.completeRecording({ recording, actorId, now: this.now().toISOString() });
  }

  async start(actorId: string, meetingId: string, requestId: string, request: StartLiveSessionRequest) {
    const { meeting } = await this.context(actorId, meetingId, true);
    if (meeting.status !== MeetingStatus.SCHEDULED) throw new UnprocessableEntityError('Only a scheduled meeting can start live transcription.');
    const allowlist = supportedLanguages();
    if (!allowlist.size) throw new ServiceConfigurationError('Transcribe language allowlist is empty.');
    if (!allowlist.has(request.languageCode)) throw new UnprocessableEntityError('languageCode is not enabled for this environment.');
    const capture = await this.repository.findAcceptedConsent(meetingId, actorId);
    if (!capture) throw new ForbiddenError('Accepted capture consent is required before live transcription.');
    const now = this.now();
    const connection = await this.connections.create({ languageCode: request.languageCode, resumeFromSequence: 0 });
    const created = await this.repository.createSession({ meetingId, groupId: meeting.groupId, actorId, recording: capture.recording, consent: capture.consent, languageCode: request.languageCode, requestId, now: now.toISOString(), heartbeatExpiresAt: new Date(now.getTime() + HEARTBEAT_TTL_MS).toISOString() });
    return startLiveSessionResponseSchema.parse({ ...created, connection });
  }

  async get(actorId: string, meetingId: string, sessionId: string) {
    return this.authorizedSession(actorId, meetingId, sessionId, false);
  }

  async heartbeat(actorId: string, meetingId: string, sessionId: string) {
    const session = await this.authorizedSession(actorId, meetingId, sessionId);
    if (session.status === 'FAILED') throw new UnprocessableEntityError('Live session has failed.');
    const now = this.now();
    const updated = await this.repository.transitionSession({ session, from: ['ACTIVE', 'RECONNECTING'], to: 'ACTIVE', now: now.toISOString(), heartbeatExpiresAt: new Date(now.getTime() + HEARTBEAT_TTL_MS).toISOString() });
    return heartbeatResponseSchema.parse({ session: updated });
  }

  async reconnect(actorId: string, meetingId: string, sessionId: string) {
    const session = await this.authorizedSession(actorId, meetingId, sessionId);
    if (!['ACTIVE', 'RECONNECTING'].includes(session.status)) throw new UnprocessableEntityError('Live session cannot reconnect from its current state.');
    const now = this.now();
    const updated = await this.repository.transitionSession({ session, from: ['ACTIVE', 'RECONNECTING'], to: 'RECONNECTING', now: now.toISOString(), heartbeatExpiresAt: new Date(now.getTime() + HEARTBEAT_TTL_MS).toISOString() });
    const connection = await this.connections.create({ languageCode: session.languageCode, resumeFromSequence: session.lastAcceptedSequence + 1 });
    return reconnectResponseSchema.parse({ session: updated, connection });
  }

  async append(actorId: string, meetingId: string, sessionId: string, request: AppendFinalSegmentsRequest) {
    const session = await this.authorizedSession(actorId, meetingId, sessionId);
    if (session.status !== 'ACTIVE') throw new UnprocessableEntityError('Live session is not active.');
    if (request.segments.some((segment) => segment.languageCode !== session.languageCode)) throw new ConflictError('Segment language does not match the live session.');
    return this.repository.appendFinalSegments({ session, segments: request.segments, now: this.now().toISOString() });
  }

  async gap(actorId: string, meetingId: string, sessionId: string, gap: Parameters<LiveTranscriptionRepository['putGap']>[0]['gap']) {
    const session = await this.authorizedSession(actorId, meetingId, sessionId);
    if (!['ACTIVE', 'RECONNECTING'].includes(session.status)) throw new UnprocessableEntityError('Live session cannot accept gap metadata.');
    return this.repository.putGap({ session, gap, now: this.now().toISOString() });
  }

  async finalize(actorId: string, meetingId: string, sessionId: string, request: FinalizeLiveSessionRequest) {
    const session = await this.authorizedSession(actorId, meetingId, sessionId);
    if (session.status === 'STOPPED' || session.status === 'FAILED') {
      const transcript = await this.repository.getTranscript(session.transcriptId);
      if (!transcript) throw new Error('TRANSCRIPT_DATA_INTEGRITY');
      return finalizeLiveSessionResponseSchema.parse({ session, transcript });
    }
    return finalizeLiveSessionResponseSchema.parse(await this.repository.finalize({ session, failed: request.failed, ...(request.failureCode ? { failureCode: request.failureCode } : {}), now: this.now().toISOString() }));
  }
}
