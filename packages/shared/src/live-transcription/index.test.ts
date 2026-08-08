import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LIVE_LANGUAGE_CODE, appendFinalSegmentsRequestSchema, finalTranscriptSegmentRequestSchema,
  liveLanguageCodeSchema, liveSessionSchema, recordingSchema, startLiveSessionRequestSchema,
} from '.';

describe('M2 live transcription contracts', () => {
  it('defaults the frontend boundary to vi-VN', () => expect(DEFAULT_LIVE_LANGUAGE_CODE).toBe('vi-VN'));
  it.each(['vi-VN', 'en-US', 'ja-JP'])('accepts explicit BCP-47 language %s', (value) => expect(liveLanguageCodeSchema.parse(value)).toBe(value));
  it.each(['AUTO', 'auto', 'Deepgram', '', 'vietnamese'])('rejects unsupported language shape %s', (value) => expect(() => startLiveSessionRequestSchema.parse({ languageCode: value })).toThrow());
  it('rejects partial provider results', () => expect(() => finalTranscriptSegmentRequestSchema.parse({ resultId: 'r1', sequence: 0, startMs: 0, endMs: 10, text: 'hello', confidence: 1, languageCode: 'vi-VN', speakerLabel: 'Speaker 1', isFinal: false })).toThrow());
  it('requires bounded final batches', () => expect(() => appendFinalSegmentsRequestSchema.parse({ segments: [] })).toThrow());
  it('requires valid segment time ranges', () => expect(() => finalTranscriptSegmentRequestSchema.parse({ resultId: 'r1', sequence: 0, startMs: 20, endMs: 10, text: 'hello', confidence: 1, languageCode: 'vi-VN', speakerLabel: 'Speaker 1', isFinal: true })).toThrow());
  it('keeps session sequence explicit', () => expect(liveSessionSchema.parse({ sessionId: 's', meetingId: 'm', groupId: 'g', transcriptId: 't', recordingId: 'r', consentId: 'c', startedBy: 'u', captureSource: 'TAB_AUDIO', languageCode: 'vi-VN', status: 'ACTIVE', lastAcceptedSequence: -1, lastHeartbeatAt: '2026-08-08T00:00:00.000Z', heartbeatExpiresAt: '2026-08-08T00:01:00.000Z', startedAt: '2026-08-08T00:00:00.000Z', updatedAt: '2026-08-08T00:00:00.000Z' }).lastAcceptedSequence).toBe(-1));
  it('allows consent intent before recording size is known', () => expect(recordingSchema.parse({ recordingId: 'r', meetingId: 'm', groupId: 'g', consentId: 'c', captureSource: 'TAB_AUDIO', status: 'CONSENTED', objectKey: 'uploads/g/m/recordings/r/audio.webm', contentType: 'audio/webm', createdBy: 'u', createdAt: '2026-08-08T00:00:00.000Z', updatedAt: '2026-08-08T00:00:00.000Z', retentionUntil: '2026-08-15T00:00:00.000Z' }).sizeBytes).toBeUndefined());
});
