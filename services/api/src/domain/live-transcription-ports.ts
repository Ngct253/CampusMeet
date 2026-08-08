import type {
  Consent, CreateRecordingRequest, FinalTranscriptSegmentRequest, GapMetadata,
  LiveConnectionInfo, LiveSession, LiveSessionStatus, PrepareRecordingUploadRequest, Recording, Transcript, TranscriptSegment,
} from '@campusmeet/shared';

export interface LiveTranscriptionRepository {
  createRecording(input: { meetingId: string; groupId: string; actorId: string; requestId: string; request: CreateRecordingRequest; objectKey: string; now: string; retentionUntil: string }): Promise<{ recording: Recording; consent: Consent }>;
  prepareRecordingUpload(input: { recordingId: string; actorId: string; request: PrepareRecordingUploadRequest; now: string }): Promise<Recording>;
  getRecording(recordingId: string): Promise<Recording | null>;
  completeRecording(input: { recording: Recording; actorId: string; now: string }): Promise<Recording>;
  findAcceptedConsent(meetingId: string, actorId: string): Promise<{ recording: Recording; consent: Consent } | null>;
  getSession(meetingId: string, sessionId: string): Promise<LiveSession | null>;
  getTranscript(transcriptId: string): Promise<Transcript | null>;
  createSession(input: { meetingId: string; groupId: string; actorId: string; recording: Recording; consent: Consent; languageCode: string; requestId: string; now: string; heartbeatExpiresAt: string }): Promise<{ session: LiveSession; transcript: Transcript }>;
  transitionSession(input: { session: LiveSession; from: LiveSessionStatus[]; to: LiveSessionStatus; now: string; heartbeatExpiresAt?: string; failureCode?: string }): Promise<LiveSession>;
  appendFinalSegments(input: { session: LiveSession; segments: FinalTranscriptSegmentRequest[]; now: string }): Promise<{ session: LiveSession; segments: TranscriptSegment[] }>;
  putGap(input: { session: LiveSession; gap: Omit<GapMetadata, 'gapId' | 'sessionId' | 'meetingId' | 'createdAt'>; now: string }): Promise<GapMetadata>;
  finalize(input: { session: LiveSession; failed: boolean; failureCode?: string; now: string }): Promise<{ session: LiveSession; transcript: Transcript }>;
}

export interface LiveConnectionSigner {
  create(input: { languageCode: string; resumeFromSequence: number }): Promise<LiveConnectionInfo>;
}

export interface RecordingUploadSigner {
  createUploadUrl(input: { objectKey: string; contentType: string; checksum: string }): Promise<string>;
  head(objectKey: string): Promise<{ sizeBytes: number; contentType?: string; checksum?: string }>;
}
