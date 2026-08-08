import { EventStreamCodec } from '@smithy/eventstream-codec';
import type { FinalTranscriptSegmentRequest, LiveSession } from '@campusmeet/shared';
import { appendFinalSegments, completeRecording, createRecordingIntent, heartbeatLiveSession, prepareRecordingUpload, reconnectLiveSession, reportLiveGap, startLiveSession, stopLiveSession } from './live-service';

export type CaptureUiState = 'IDLE' | 'CONSENT_REQUIRED' | 'CONNECTING' | 'LIVE' | 'RECONNECTING' | 'FINALIZING' | 'READY' | 'FAILED';
type Listener = (state: CaptureUiState, detail?: string) => void;
const codec = new EventStreamCodec((value) => new TextDecoder().decode(value), (value) => new TextEncoder().encode(value));
const audioMessage = (body: Uint8Array) => codec.encode({ headers: {
  ':message-type': { type: 'string', value: 'event' }, ':event-type': { type: 'string', value: 'AudioEvent' },
  ':content-type': { type: 'string', value: 'application/octet-stream' },
}, body });
export const resamplePcm16 = (samples: Float32Array, sourceRate: number) => {
  const ratio = sourceRate / 16000; const output = new Int16Array(Math.max(1, Math.floor(samples.length / ratio)));
  for (let i = 0; i < output.length; i += 1) {
    const start = Math.floor(i * ratio); const end = Math.max(start + 1, Math.floor((i + 1) * ratio));
    let sum = 0; for (let j = start; j < end && j < samples.length; j += 1) sum += samples[j]!;
    const value = Math.max(-1, Math.min(1, sum / (end - start)));
    output[i] = value < 0 ? value * 0x8000 : value * 0x7fff;
  }
  return new Uint8Array(output.buffer);
};

export class LiveCaptureController {
  private stream?: MediaStream; private recorder?: MediaRecorder; private chunks: Blob[] = [];
  private socket?: WebSocket; private audioContext?: AudioContext; private processor?: ScriptProcessorNode;
  private session?: LiveSession; private recordingId?: string; private sequence = 0; private heartbeat?: number;
  private stopping = false; private startedAt = 0;
  constructor(private readonly meetingId: string, private readonly listener: Listener) {}
  private state(value: CaptureUiState, detail?: string) { this.listener(value, detail); }
  async start(languageCode = 'vi-VN', source: 'TAB_AUDIO' | 'MICROPHONE' = 'TAB_AUDIO') {
    this.state('CONSENT_REQUIRED'); this.stopping = false; const key = crypto.randomUUID();
    const recording = await createRecordingIntent(this.meetingId, { captureSource: source, consent: true, consentNoticeVersion: 'm2-live-v1', contentType: 'audio/webm' }, key);
    this.recordingId = recording.recording.recordingId;
    this.stream = source === 'TAB_AUDIO' ? await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true }) : await navigator.mediaDevices.getUserMedia({ audio: true });
    if (!this.stream.getAudioTracks().length) { this.stream.getTracks().forEach((track) => track.stop()); throw new Error('No audio track was selected.'); }
    this.state('CONNECTING'); const started = await startLiveSession(this.meetingId, { languageCode }, key);
    this.session = started.session; this.sequence = started.session.lastAcceptedSequence + 1; this.startedAt = Date.now();
    this.recorder = new MediaRecorder(this.stream, { mimeType: 'audio/webm' });
    this.recorder.ondataavailable = (event) => { if (event.data.size) this.chunks.push(event.data); }; this.recorder.start(1000);
    await this.connect(started.connection.url); this.heartbeat = window.setInterval(() => void this.sendHeartbeat(), 15_000);
  }
  private async connect(url: string) {
    const socket = new WebSocket(url); socket.binaryType = 'arraybuffer'; this.socket = socket;
    await new Promise<void>((resolve, reject) => { socket.onopen = () => resolve(); socket.onerror = () => reject(new Error('Transcribe connection failed.')); });
    socket.onmessage = (event) => void this.receive(event.data as ArrayBuffer); socket.onclose = () => { if (!this.stopping) void this.reconnect(); };
    this.audioContext = new AudioContext(); const source = this.audioContext.createMediaStreamSource(this.stream!);
    this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);
    this.processor.onaudioprocess = (event) => { if (socket.readyState === WebSocket.OPEN) socket.send(audioMessage(resamplePcm16(event.inputBuffer.getChannelData(0), event.inputBuffer.sampleRate))); };
    source.connect(this.processor); this.processor.connect(this.audioContext.destination); this.state('LIVE');
  }
  private async receive(buffer: ArrayBuffer) {
    const message = codec.decode(new Uint8Array(buffer)); const eventType = message.headers[':event-type'];
    if (eventType?.type !== 'string' || eventType.value !== 'TranscriptEvent') return;
    const payload = JSON.parse(new TextDecoder().decode(message.body)) as { Transcript?: { Results?: Array<{ IsPartial?: boolean; ResultId?: string; StartTime?: number; EndTime?: number; Alternatives?: Array<{ Transcript?: string; Confidence?: number; Items?: Array<{ Speaker?: string }> }> }> } };
    for (const result of payload.Transcript?.Results ?? []) {
      const alternative = result.Alternatives?.[0];
      if (result.IsPartial !== false || !result.ResultId || !alternative?.Transcript?.trim() || !this.session) continue;
      const segment: FinalTranscriptSegmentRequest = { resultId: result.ResultId, sequence: this.sequence, startMs: Math.round((result.StartTime ?? 0) * 1000), endMs: Math.round((result.EndTime ?? 0) * 1000), text: alternative.Transcript.trim(), confidence: alternative.Confidence ?? 0, languageCode: this.session.languageCode, speakerLabel: `Speaker ${Number(alternative.Items?.[0]?.Speaker ?? 0) + 1}`, isFinal: true };
      await appendFinalSegments(this.meetingId, this.session.sessionId, { segments: [segment] }); this.sequence += 1;
    }
  }
  private async sendHeartbeat() { if (this.session && !this.stopping) this.session = (await heartbeatLiveSession(this.meetingId, this.session.sessionId)).session; }
  private async reconnect() {
    if (!this.session || this.stopping) return; this.state('RECONNECTING'); const from = this.sequence;
    const response = await reconnectLiveSession(this.meetingId, this.session.sessionId); this.session = response.session; this.sequence = response.connection.resumeFromSequence;
    const elapsed = Date.now() - this.startedAt; await reportLiveGap(this.meetingId, this.session.sessionId, { fromSequence: from, toSequence: Math.max(from, this.sequence), startMs: elapsed, endMs: elapsed, reason: 'CONNECTION_LOST' });
    await this.connect(response.connection.url);
  }
  async stop() {
    if (!this.session || !this.recordingId) return; this.stopping = true; this.state('FINALIZING');
    if (this.heartbeat) clearInterval(this.heartbeat); if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(audioMessage(new Uint8Array()));
    await new Promise((resolve) => setTimeout(resolve, 500)); this.socket?.close(); this.processor?.disconnect(); await this.audioContext?.close();
    const stopped = new Promise<void>((resolve) => { if (!this.recorder || this.recorder.state === 'inactive') resolve(); else { this.recorder.onstop = () => resolve(); this.recorder.stop(); } });
    this.stream?.getTracks().forEach((track) => track.stop()); await stopped;
    const blob = new Blob(this.chunks, { type: 'audio/webm' }); const checksum = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))).map((byte) => byte.toString(16).padStart(2, '0')).join('');
    const upload = await prepareRecordingUpload(this.meetingId, this.recordingId, { sizeBytes: blob.size, checksum, durationMs: Math.max(1, Date.now() - this.startedAt) });
    const response = await fetch(upload.uploadUrl, { method: 'PUT', headers: { 'content-type': 'audio/webm', 'x-amz-meta-checksum': checksum }, body: blob }); if (!response.ok) throw new Error('Recording upload failed.');
    await completeRecording(this.meetingId, this.recordingId);
    await stopLiveSession(this.meetingId, this.session.sessionId, { failed: false }); this.state('READY');
  }
  async fail(code = 'CLIENT_CAPTURE_FAILED') { if (this.stopping) return; this.stopping = true; if (this.session) await stopLiveSession(this.meetingId, this.session.sessionId, { failed: true, failureCode: code }); this.state('FAILED'); }
}
