import { z } from 'zod';
import { transcriptSchema, transcriptSegmentSchema } from '../transcript';

const idSchema = z.string().trim().min(1).max(160);
const isoDateTimeSchema = z.string().datetime({ offset: true });
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/i);
export const DEFAULT_LIVE_LANGUAGE_CODE = 'vi-VN' as const;
export const liveLanguageCodeSchema = z.string().trim().min(2).max(35)
  .regex(/^[a-z]{2,3}(?:-[A-Z][a-z]{3})?(?:-[A-Z]{2}|-\d{3})?$/, 'Invalid languageCode.')
  .refine((value) => value.toUpperCase() !== 'AUTO', 'AUTO is not supported.');
export type LiveLanguageCode = z.infer<typeof liveLanguageCodeSchema>;
export const captureSourceSchema = z.enum(['TAB_AUDIO', 'MICROPHONE']);
export type CaptureSource = z.infer<typeof captureSourceSchema>;
export const consentSchema = z.object({
  consentId: idSchema, meetingId: idSchema, recordingId: idSchema, actorId: idSchema,
  decision: z.enum(['ACCEPTED', 'DECLINED']), noticeVersion: z.string().trim().min(1).max(64),
  captureSource: captureSourceSchema, consentedAt: isoDateTimeSchema, retentionUntil: isoDateTimeSchema,
}).strict();
export type Consent = z.infer<typeof consentSchema>;
export const recordingStatusSchema = z.enum(['CONSENTED', 'PENDING_UPLOAD', 'RECORDING', 'FINALIZING', 'READY', 'FAILED']);
export type RecordingStatus = z.infer<typeof recordingStatusSchema>;
export const recordingSchema = z.object({
  recordingId: idSchema, meetingId: idSchema, groupId: idSchema, consentId: idSchema,
  captureSource: captureSourceSchema, status: recordingStatusSchema,
  objectKey: z.string().trim().min(1).max(1024), contentType: z.enum(['audio/webm', 'audio/wav']),
  sizeBytes: z.number().int().positive().max(500_000_000).optional(), checksum: sha256Schema.optional(),
  durationMs: z.number().int().positive().max(21_600_000).optional(), createdBy: idSchema,
  createdAt: isoDateTimeSchema, updatedAt: isoDateTimeSchema, retentionUntil: isoDateTimeSchema,
}).strict();
export type Recording = z.infer<typeof recordingSchema>;
export const createRecordingRequestSchema = z.object({
  captureSource: captureSourceSchema, consent: z.literal(true),
  consentNoticeVersion: z.string().trim().min(1).max(64), contentType: z.enum(['audio/webm', 'audio/wav']),
}).strict();
export type CreateRecordingRequest = z.infer<typeof createRecordingRequestSchema>;
export const createRecordingResponseSchema = z.object({ recording: recordingSchema, consent: consentSchema }).strict();
export type CreateRecordingResponse = z.infer<typeof createRecordingResponseSchema>;
export const prepareRecordingUploadRequestSchema = z.object({
  sizeBytes: z.number().int().positive().max(500_000_000), checksum: sha256Schema,
  durationMs: z.number().int().positive().max(21_600_000),
}).strict();
export type PrepareRecordingUploadRequest = z.infer<typeof prepareRecordingUploadRequestSchema>;
export const prepareRecordingUploadResponseSchema = z.object({
  recording: recordingSchema, uploadUrl: z.string().url(), uploadExpiresAt: isoDateTimeSchema,
}).strict();
export const liveSessionStatusSchema = z.enum(['STARTING', 'ACTIVE', 'RECONNECTING', 'STOPPED', 'FAILED']);
export type LiveSessionStatus = z.infer<typeof liveSessionStatusSchema>;
export const liveSessionSchema = z.object({
  sessionId: idSchema, meetingId: idSchema, groupId: idSchema, transcriptId: idSchema,
  recordingId: idSchema, consentId: idSchema, startedBy: idSchema, captureSource: captureSourceSchema,
  languageCode: liveLanguageCodeSchema, status: liveSessionStatusSchema,
  lastAcceptedSequence: z.number().int().min(-1).max(9_999_999_999),
  lastHeartbeatAt: isoDateTimeSchema, heartbeatExpiresAt: isoDateTimeSchema,
  startedAt: isoDateTimeSchema, updatedAt: isoDateTimeSchema,
  failureCode: z.string().trim().min(1).max(100).optional(),
}).strict();
export type LiveSession = z.infer<typeof liveSessionSchema>;
export const liveConnectionInfoSchema = z.object({
  url: z.string().url().refine((value) => value.startsWith('wss://')), expiresAt: isoDateTimeSchema,
  mediaEncoding: z.literal('pcm'), sampleRateHertz: z.literal(16000), languageCode: liveLanguageCodeSchema,
  resumeFromSequence: z.number().int().min(0).max(9_999_999_999),
}).strict();
export type LiveConnectionInfo = z.infer<typeof liveConnectionInfoSchema>;
export const startLiveSessionRequestSchema = z.object({ languageCode: liveLanguageCodeSchema }).strict();
export type StartLiveSessionRequest = z.infer<typeof startLiveSessionRequestSchema>;
export const startLiveSessionResponseSchema = z.object({ session: liveSessionSchema, transcript: transcriptSchema, connection: liveConnectionInfoSchema }).strict();
export type StartLiveSessionResponse = z.infer<typeof startLiveSessionResponseSchema>;
export const heartbeatRequestSchema = z.object({}).strict();
export type HeartbeatRequest = z.infer<typeof heartbeatRequestSchema>;
export const heartbeatResponseSchema = z.object({ session: liveSessionSchema }).strict();
export type HeartbeatResponse = z.infer<typeof heartbeatResponseSchema>;
export const reconnectRequestSchema = z.object({}).strict();
export type ReconnectRequest = z.infer<typeof reconnectRequestSchema>;
export const reconnectResponseSchema = z.object({ session: liveSessionSchema, connection: liveConnectionInfoSchema }).strict();
export type ReconnectResponse = z.infer<typeof reconnectResponseSchema>;
export const finalTranscriptSegmentRequestSchema = z.object({
  resultId: idSchema, sequence: z.number().int().nonnegative().max(9_999_999_999),
  startMs: z.number().int().nonnegative(), endMs: z.number().int().nonnegative(),
  text: z.string().trim().min(1).max(10_000), confidence: z.number().min(0).max(1),
  languageCode: liveLanguageCodeSchema, speakerLabel: z.string().regex(/^Speaker [1-9]\d*$/), isFinal: z.literal(true),
}).strict().refine((value) => value.endMs >= value.startMs, { path: ['endMs'] });
export type FinalTranscriptSegmentRequest = z.infer<typeof finalTranscriptSegmentRequestSchema>;
export const appendFinalSegmentsRequestSchema = z.object({ segments: z.array(finalTranscriptSegmentRequestSchema).min(1).max(25) }).strict();
export type AppendFinalSegmentsRequest = z.infer<typeof appendFinalSegmentsRequestSchema>;
export const appendFinalSegmentsResponseSchema = z.object({ session: liveSessionSchema, segments: z.array(transcriptSegmentSchema) }).strict();
const gapMetadataBaseSchema = z.object({
  gapId: idSchema, sessionId: idSchema, meetingId: idSchema,
  fromSequence: z.number().int().nonnegative().max(9_999_999_999), toSequence: z.number().int().nonnegative().max(9_999_999_999),
  startMs: z.number().int().nonnegative(), endMs: z.number().int().nonnegative(),
  reason: z.enum(['CONNECTION_LOST', 'DEVICE_LOST', 'AUDIO_UNAVAILABLE']), createdAt: isoDateTimeSchema,
}).strict();
export const gapMetadataSchema = gapMetadataBaseSchema.refine((value) => value.toSequence >= value.fromSequence && value.endMs >= value.startMs);
export type GapMetadata = z.infer<typeof gapMetadataSchema>;
export const reportGapRequestSchema = gapMetadataBaseSchema.omit({ gapId: true, sessionId: true, meetingId: true, createdAt: true })
  .refine((value) => value.toSequence >= value.fromSequence && value.endMs >= value.startMs);
export const finalizeLiveSessionRequestSchema = z.object({
  failed: z.boolean().default(false), failureCode: z.string().trim().min(1).max(100).optional(),
}).strict().refine((value) => !value.failed || value.failureCode !== undefined, { path: ['failureCode'] });
export type FinalizeLiveSessionRequest = z.infer<typeof finalizeLiveSessionRequestSchema>;
export const finalizeLiveSessionResponseSchema = z.object({ session: liveSessionSchema, transcript: transcriptSchema }).strict();
export type FinalizeLiveSessionResponse = z.infer<typeof finalizeLiveSessionResponseSchema>;
