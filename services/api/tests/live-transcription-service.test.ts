import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LiveTranscriptionService } from '../src/services/live-transcription-service';

const now = new Date('2026-08-08T10:00:00.000Z');
const recording = { recordingId: 'recording-1', meetingId: 'meeting-1', groupId: 'group-1', consentId: 'consent-1', captureSource: 'TAB_AUDIO' as const, status: 'CONSENTED' as const, objectKey: 'uploads/group-1/meeting-1/recordings/recording-1/audio.webm', contentType: 'audio/webm' as const, createdBy: 'organizer-1', createdAt: now.toISOString(), updatedAt: now.toISOString(), retentionUntil: '2026-08-15T10:00:00.000Z' };
const consent = { consentId: 'consent-1', meetingId: 'meeting-1', recordingId: 'recording-1', actorId: 'organizer-1', decision: 'ACCEPTED' as const, noticeVersion: 'v1', captureSource: 'TAB_AUDIO' as const, consentedAt: now.toISOString(), retentionUntil: '2026-08-15T10:00:00.000Z' };
const transcript = { transcriptId: 'transcript-1', meetingId: 'meeting-1', groupId: 'group-1', status: 'LIVE' as const, version: 1, createdAt: now.toISOString(), updatedAt: now.toISOString() };
const session = { sessionId: 'session-1', meetingId: 'meeting-1', groupId: 'group-1', transcriptId: 'transcript-1', recordingId: 'recording-1', consentId: 'consent-1', startedBy: 'organizer-1', captureSource: 'TAB_AUDIO' as const, languageCode: 'vi-VN', status: 'ACTIVE' as const, lastAcceptedSequence: 4, lastHeartbeatAt: now.toISOString(), heartbeatExpiresAt: '2026-08-08T10:01:00.000Z', startedAt: now.toISOString(), updatedAt: now.toISOString() };
const connection = { url: 'wss://transcribestreaming.ap-southeast-1.amazonaws.com:8443/path?signature=x', expiresAt: '2026-08-08T10:01:00.000Z', mediaEncoding: 'pcm' as const, sampleRateHertz: 16000 as const, languageCode: 'vi-VN', resumeFromSequence: 0 };

describe('LiveTranscriptionService', () => {
  let repository: Record<string, ReturnType<typeof vi.fn>>;
  let membership = { active: true, role: 'MEMBER' };
  const meeting = { id: 'meeting-1', groupId: 'group-1', organizerId: 'organizer-1', status: 'SCHEDULED' };
  const connections = { create: vi.fn() };
  const uploads = { createUploadUrl: vi.fn(), head: vi.fn() };
  const make = () => new LiveTranscriptionService(repository as never, { getById: vi.fn().mockResolvedValue(meeting) } as never, { getMembership: vi.fn().mockImplementation(async () => membership) } as never, connections, uploads, () => now);
  beforeEach(() => {
    membership = { active: true, role: 'MEMBER' };
    connections.create.mockReset().mockResolvedValue(connection);
    uploads.createUploadUrl.mockReset().mockResolvedValue('https://bucket.example/upload');
    uploads.head.mockReset().mockResolvedValue({ sizeBytes: 12, contentType: 'audio/webm', checksum: 'a'.repeat(64) });
    repository = {
      createRecording: vi.fn().mockResolvedValue({ recording, consent }),
      prepareRecordingUpload: vi.fn().mockResolvedValue({ ...recording, status: 'PENDING_UPLOAD', sizeBytes: 12, checksum: 'a'.repeat(64), durationMs: 1000 }),
      getRecording: vi.fn().mockResolvedValue({ ...recording, status: 'PENDING_UPLOAD', sizeBytes: 12, checksum: 'a'.repeat(64), durationMs: 1000 }),
      completeRecording: vi.fn().mockResolvedValue({ ...recording, status: 'READY', sizeBytes: 12, checksum: 'a'.repeat(64), durationMs: 1000 }),
      findAcceptedConsent: vi.fn().mockResolvedValue({ recording, consent }),
      getSession: vi.fn().mockResolvedValue(session),
      getTranscript: vi.fn().mockResolvedValue(transcript),
      createSession: vi.fn().mockResolvedValue({ session, transcript }),
      transitionSession: vi.fn().mockImplementation(async ({ to, heartbeatExpiresAt }) => ({ ...session, status: to, ...(heartbeatExpiresAt ? { heartbeatExpiresAt } : {}) })),
      appendFinalSegments: vi.fn().mockResolvedValue({ session, segments: [] }),
      putGap: vi.fn(),
      finalize: vi.fn().mockResolvedValue({ session: { ...session, status: 'STOPPED' }, transcript: { ...transcript, status: 'READY' } }),
    };
  });
  it('denies an ordinary active member from starting capture', async () => {
    await expect(make().start('member-1', 'meeting-1', 'key', { languageCode: 'vi-VN' })).rejects.toMatchObject({ statusCode: 403 });
    expect(connections.create).not.toHaveBeenCalled();
  });
  it('denies start before persisted consent', async () => {
    repository.findAcceptedConsent!.mockResolvedValue(null);
    await expect(make().start('organizer-1', 'meeting-1', 'key', { languageCode: 'vi-VN' })).rejects.toMatchObject({ statusCode: 403 });
  });
  it('starts for the organizer and creates one canonical producer session', async () => {
    const result = await make().start('organizer-1', 'meeting-1', 'key', { languageCode: 'vi-VN' });
    expect(result.session.sessionId).toBe('session-1'); expect(result.transcript.status).toBe('LIVE');
    expect(repository.createSession).toHaveBeenCalledOnce();
  });
  it('allows an active Group Admin to start', async () => {
    membership = { active: true, role: 'GROUP_ADMIN' };
    await expect(make().start('admin-1', 'meeting-1', 'key', { languageCode: 'vi-VN' })).resolves.toBeDefined();
  });
  it('rejects a language outside the environment allowlist', async () => {
    await expect(make().start('organizer-1', 'meeting-1', 'key', { languageCode: 'fr-FR' })).rejects.toMatchObject({ statusCode: 422 });
  });
  it('reconnects with the next server-authoritative sequence', async () => {
    connections.create.mockResolvedValue({ ...connection, resumeFromSequence: 5 });
    const result = await make().reconnect('organizer-1', 'meeting-1', 'session-1');
    expect(result.connection.resumeFromSequence).toBe(5);
    expect(connections.create).toHaveBeenCalledWith({ languageCode: 'vi-VN', resumeFromSequence: 5 });
  });
  it('refreshes heartbeat only for a nonterminal session', async () => {
    const result = await make().heartbeat('organizer-1', 'meeting-1', 'session-1');
    expect(result.session.status).toBe('ACTIVE'); expect(repository.transitionSession).toHaveBeenCalledOnce();
  });
  it('turns an expired heartbeat into FAILED deterministically', async () => {
    repository.getSession!.mockResolvedValue({ ...session, heartbeatExpiresAt: '2026-08-08T09:59:00.000Z' });
    repository.finalize!.mockResolvedValue({ session: { ...session, status: 'FAILED' }, transcript: { ...transcript, status: 'FAILED' } });
    await expect(make().heartbeat('organizer-1', 'meeting-1', 'session-1')).rejects.toMatchObject({ statusCode: 422 });
    expect(repository.finalize).toHaveBeenCalledWith(expect.objectContaining({ failed: true, failureCode: 'HEARTBEAT_EXPIRED' }));
  });
  it('rejects a final segment whose language conflicts with the session', async () => {
    await expect(make().append('organizer-1', 'meeting-1', 'session-1', { segments: [{ resultId: 'r', sequence: 5, startMs: 0, endMs: 10, text: 'hello', confidence: 1, languageCode: 'en-US', speakerLabel: 'Speaker 1', isFinal: true }] })).rejects.toMatchObject({ statusCode: 409 });
  });
  it('finalizes only to the M2 READY producer state', async () => {
    const result = await make().finalize('organizer-1', 'meeting-1', 'session-1', { failed: false });
    expect(result.transcript.status).toBe('READY'); expect(result.transcript.status).not.toBe('APPROVED');
  });
  it('persists consent before returning a recording intent', async () => {
    const result = await make().createRecording('organizer-1', 'meeting-1', 'key', { captureSource: 'TAB_AUDIO', consent: true, consentNoticeVersion: 'v1', contentType: 'audio/webm' });
    expect(result.consent.actorId).toBe('organizer-1'); expect(repository.createRecording).toHaveBeenCalledOnce();
  });
  it('marks recording READY only after private object metadata is verified', async () => {
    const result = await make().completeRecording('organizer-1', 'meeting-1', 'recording-1');
    expect(result.status).toBe('READY'); expect(repository.completeRecording).toHaveBeenCalledOnce();
  });
});
