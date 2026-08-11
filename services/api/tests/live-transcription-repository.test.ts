import { beforeAll, describe, expect, it, vi } from 'vitest';
import { DynamoDbLiveTranscriptionRepository } from '../src/repositories/live-transcription';

const session = { sessionId: 'session-1', meetingId: 'meeting-1', groupId: 'group-1', transcriptId: 'transcript-1', recordingId: 'recording-1', consentId: 'consent-1', startedBy: 'user-1', captureSource: 'TAB_AUDIO' as const, languageCode: 'vi-VN', status: 'ACTIVE' as const, lastAcceptedSequence: -1, lastHeartbeatAt: '2026-08-08T00:00:00.000Z', heartbeatExpiresAt: '2026-08-08T00:01:00.000Z', startedAt: '2026-08-08T00:00:00.000Z', updatedAt: '2026-08-08T00:00:00.000Z' };
const segment = { resultId: 'provider-result-1', sequence: 0, startMs: 0, endMs: 500, text: 'safe test text', confidence: 0.9, languageCode: 'vi-VN', speakerLabel: 'Speaker 1', isFinal: true as const };

describe('DynamoDbLiveTranscriptionRepository', () => {
  beforeAll(() => { process.env.MEETING_DATA_TABLE = 'meeting-data'; });
  it('persists a final segment and advances sequence atomically', async () => {
    const send = vi.fn().mockResolvedValue({});
    const repository = new DynamoDbLiveTranscriptionRepository({ send } as never);
    const result = await repository.appendFinalSegments({ session, segments: [segment], now: '2026-08-08T00:00:01.000Z' });
    expect(result.session.lastAcceptedSequence).toBe(0); expect(result.segments).toHaveLength(1);
    const transaction = send.mock.calls[0]![0].input.TransactItems;
    expect(transaction).toHaveLength(2); expect(transaction[0].Put.ConditionExpression).toContain('attribute_not_exists');
    expect(transaction[1].Update.ConditionExpression).toContain('lastAcceptedSequence = :previous');
  });
  it('returns the same persisted segment on an identical retry without another write', async () => {
    const firstSend = vi.fn().mockResolvedValue({});
    const repository = new DynamoDbLiveTranscriptionRepository({ send: firstSend } as never);
    const first = await repository.appendFinalSegments({ session, segments: [segment], now: '2026-08-08T00:00:01.000Z' });
    const stored = { PK: 'TRANSCRIPT#transcript-1', SK: `SEGMENT#0000000000#${first.segments[0]!.segmentId}`, entityType: 'TRANSCRIPT_SEGMENT', ...first.segments[0], resultId: segment.resultId, sessionId: session.sessionId };
    const replaySend = vi.fn().mockResolvedValue({ Item: stored });
    const replayRepository = new DynamoDbLiveTranscriptionRepository({ send: replaySend } as never);
    const replay = await replayRepository.appendFinalSegments({ session: first.session, segments: [segment], now: '2026-08-08T00:00:02.000Z' });
    expect(replay.segments[0]!.segmentId).toBe(first.segments[0]!.segmentId); expect(replaySend).toHaveBeenCalledOnce();
  });
  it('rejects non-contiguous final sequence', async () => {
    const repository = new DynamoDbLiveTranscriptionRepository({ send: vi.fn() } as never);
    await expect(repository.appendFinalSegments({ session, segments: [{ ...segment, sequence: 2 }], now: '2026-08-08T00:00:01.000Z' })).rejects.toMatchObject({ statusCode: 409 });
  });
  it('stores gaps without transcript text', async () => {
    const send = vi.fn().mockResolvedValue({}); const repository = new DynamoDbLiveTranscriptionRepository({ send } as never);
    const gap = await repository.putGap({ session, gap: { fromSequence: 0, toSequence: 1, startMs: 100, endMs: 200, reason: 'CONNECTION_LOST' }, now: '2026-08-08T00:00:01.000Z' });
    expect(gap).not.toHaveProperty('text'); expect(send.mock.calls[0]![0].input.Item.entityType).toBe('LIVE_TRANSCRIPTION_GAP');
  });
});
