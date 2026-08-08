import { describe, expect, it } from 'vitest';
import {
  MAX_TRANSCRIPT_VERSION,
  MAX_TRANSCRIPT_SEQUENCE,
  approveTranscriptResponseSchema,
  approveTranscriptRequestSchema,
  transcriptSchema,
  transcriptSegmentSchema,
  transcriptStatusSchema,
  transcriptWithSegmentsSchema,
  updateTranscriptSegmentRequestSchema,
} from './index';

const readyTranscript = {
  transcriptId: 'transcript-1',
  meetingId: 'meeting-1',
  groupId: 'group-1',
  status: 'READY',
  version: 2,
  createdAt: '2026-08-08T08:00:00.000Z',
  updatedAt: '2026-08-08T08:05:00.000Z',
} as const;

const approvedTranscript = {
  ...readyTranscript,
  status: 'APPROVED',
  approvedVersion: 2,
  approvedBy: 'user-1',
  approvedAt: '2026-08-08T08:06:00.000Z',
} as const;

const segment = {
  segmentId: 'segment-1',
  transcriptId: 'transcript-1',
  sequence: 0,
  startMs: 0,
  endMs: 1500,
  text: 'Speaker 1 trình bày tiến độ.',
  confidence: 0.98,
  languageCode: 'vi-VN',
  speakerLabel: 'Speaker 1',
  isFinal: true,
  version: 2,
  updatedBy: 'user-1',
  updatedAt: '2026-08-08T08:05:00.000Z',
} as const;

describe('transcriptStatusSchema', () => {
  it('accepts exactly the canonical transcript lifecycle states', () => {
    expect(transcriptStatusSchema.options).toEqual([
      'LIVE',
      'FINALIZING',
      'READY',
      'APPROVED',
      'FAILED',
    ]);
    for (const status of transcriptStatusSchema.options) {
      expect(transcriptStatusSchema.safeParse(status).success).toBe(true);
    }
    for (const status of ['DRAFT', 'PENDING', 'REJECTED']) {
      expect(transcriptStatusSchema.safeParse(status).success).toBe(false);
    }
  });
});

describe('transcriptSchema', () => {
  it('accepts valid READY and APPROVED transcripts', () => {
    expect(transcriptSchema.safeParse(readyTranscript).success).toBe(true);
    expect(transcriptSchema.safeParse(approvedTranscript).success).toBe(true);
  });

  it('accepts a new READY version while preserving older approval metadata', () => {
    expect(
      transcriptSchema.safeParse({
        ...approvedTranscript,
        status: 'READY',
        version: 3,
      }).success,
    ).toBe(true);
  });

  it.each([
    ['partial approval metadata', { ...readyTranscript, approvedVersion: 1 }],
    ['approved version mismatch', { ...approvedTranscript, version: 3, approvedVersion: 2 }],
    [
      'approval version ahead of current',
      {
        ...readyTranscript,
        approvedVersion: 3,
        approvedBy: 'user-1',
        approvedAt: '2026-08-08T08:06:00.000Z',
      },
    ],
    [
      'READY with current version marked approved',
      {
        ...readyTranscript,
        approvedVersion: 2,
        approvedBy: 'user-1',
        approvedAt: '2026-08-08T08:06:00.000Z',
      },
    ],
    [
      'FAILED with historical approval metadata',
      {
        ...approvedTranscript,
        status: 'FAILED',
        version: 3,
      },
    ],
  ])('rejects invalid approval metadata: %s', (_label, input) => {
    expect(transcriptSchema.safeParse(input).success).toBe(false);
  });

  it.each([
    ['blank transcriptId', { ...readyTranscript, transcriptId: ' ' }],
    ['blank meetingId', { ...readyTranscript, meetingId: ' ' }],
    ['blank groupId', { ...readyTranscript, groupId: ' ' }],
    ['zero version', { ...readyTranscript, version: 0 }],
    ['fractional version', { ...readyTranscript, version: 1.5 }],
    ['version above maximum', { ...readyTranscript, version: MAX_TRANSCRIPT_VERSION + 1 }],
    ['createdAt without timezone', { ...readyTranscript, createdAt: '2026-08-08T08:00:00' }],
    ['invalid updatedAt', { ...readyTranscript, updatedAt: 'not-a-date' }],
    ['unknown field', { ...readyTranscript, provider: 'invented' }],
  ])('rejects %s', (_label, input) => {
    expect(transcriptSchema.safeParse(input).success).toBe(false);
  });
});

describe('transcriptSegmentSchema', () => {
  it('accepts a valid persisted final segment', () => {
    expect(transcriptSegmentSchema.safeParse(segment).success).toBe(true);
  });

  it.each([
    ['negative sequence', { ...segment, sequence: -1 }],
    ['fractional sequence', { ...segment, sequence: 1.5 }],
    ['sequence above maximum', { ...segment, sequence: MAX_TRANSCRIPT_SEQUENCE + 1 }],
    ['negative start', { ...segment, startMs: -1 }],
    ['negative end', { ...segment, endMs: -1 }],
    ['end before start', { ...segment, startMs: 2000, endMs: 1000 }],
    ['partial segment', { ...segment, isFinal: false }],
    ['invalid version', { ...segment, version: 0 }],
    ['named user as speaker', { ...segment, speakerLabel: 'Nguyễn Văn A' }],
    ['invalid confidence', { ...segment, confidence: 1.1 }],
    ['unknown field', { ...segment, speakerUserId: 'user-1' }],
  ])('rejects %s', (_label, input) => {
    expect(transcriptSegmentSchema.safeParse(input).success).toBe(false);
  });
});

describe('updateTranscriptSegmentRequestSchema', () => {
  it.each([
    { expectedVersion: 2, text: 'Nội dung đã sửa' },
    { expectedVersion: 2, speakerLabel: 'Speaker 2' },
    { expectedVersion: 2, languageCode: 'en-US' },
  ])('accepts a strict request with at least one editable field', (input) => {
    expect(updateTranscriptSegmentRequestSchema.safeParse(input).success).toBe(true);
  });

  it('requires expectedVersion and at least one editable field', () => {
    expect(updateTranscriptSegmentRequestSchema.safeParse({ text: 'Sửa' }).success).toBe(false);
    expect(updateTranscriptSegmentRequestSchema.safeParse({ expectedVersion: 2 }).success).toBe(
      false,
    );
  });

  it.each([0, -1, 1.5, MAX_TRANSCRIPT_VERSION + 1])(
    'rejects invalid expectedVersion %s',
    (expectedVersion) => {
      expect(
        updateTranscriptSegmentRequestSchema.safeParse({ expectedVersion, text: 'Sửa' }).success,
      ).toBe(false);
    },
  );

  it.each([
    'transcriptId',
    'segmentId',
    'groupId',
    'meetingId',
    'version',
    'status',
    'approvedVersion',
    'approvedBy',
    'approvedAt',
    'updatedBy',
    'updatedAt',
    'actorId',
  ])('rejects server-owned field %s', (field) => {
    expect(
      updateTranscriptSegmentRequestSchema.safeParse({
        expectedVersion: 2,
        text: 'Sửa',
        [field]: 'forged',
      }).success,
    ).toBe(false);
  });
});

describe('approveTranscriptRequestSchema', () => {
  it('accepts only a valid expectedVersion', () => {
    expect(approveTranscriptRequestSchema.parse({ expectedVersion: 2 })).toEqual({
      expectedVersion: 2,
    });
  });

  it.each([
    {},
    { expectedVersion: 0 },
    { expectedVersion: -1 },
    { expectedVersion: 1.5 },
    { expectedVersion: MAX_TRANSCRIPT_VERSION + 1 },
    { expectedVersion: 2, approvedBy: 'user-1' },
    { expectedVersion: 2, inputObjectKey: 'uploads/forged' },
  ])('rejects invalid or server-owned approval input', (input) => {
    expect(approveTranscriptRequestSchema.safeParse(input).success).toBe(false);
  });
});

describe('approveTranscriptResponseSchema', () => {
  const aiJob = {
    aiJobId: 'job-1',
    groupId: 'group-1',
    meetingId: 'meeting-1',
    type: 'INGEST_SOURCE',
    status: 'QUEUED',
    attempt: 0,
    requestId: 'request-1',
    provider: 'BEDROCK',
    createdAt: '2026-08-08T08:06:00.000Z',
    updatedAt: '2026-08-08T08:06:00.000Z',
  };

  it('returns the authoritative approved Transcript and ingestion AIJob', () => {
    expect(
      approveTranscriptResponseSchema.safeParse({
        transcript: approvedTranscript,
        aiJob,
      }).success,
    ).toBe(true);
  });

  it('rejects unknown response fields', () => {
    expect(
      approveTranscriptResponseSchema.safeParse({
        transcript: approvedTranscript,
        aiJob,
        inputObjectKey: 'uploads/secret',
      }).success,
    ).toBe(false);
  });
});

describe('transcriptWithSegmentsSchema', () => {
  it('accepts the canonical transcript, matching segments and an opaque cursor', () => {
    expect(
      transcriptWithSegmentsSchema.safeParse({
        transcript: readyTranscript,
        segments: [segment],
        nextCursor: 'eyJ2IjoxfQ',
      }).success,
    ).toBe(true);
  });

  it('accepts the no-transcript response', () => {
    expect(transcriptWithSegmentsSchema.parse({ transcript: null, segments: [] })).toEqual({
      transcript: null,
      segments: [],
    });
  });

  it.each([
    {
      transcript: null,
      segments: [segment],
    },
    {
      transcript: null,
      segments: [],
      nextCursor: 'eyJ2IjoxfQ',
    },
    {
      transcript: readyTranscript,
      segments: [{ ...segment, transcriptId: 'transcript-other' }],
    },
    {
      transcript: readyTranscript,
      segments: [{ ...segment, version: 3 }],
    },
    {
      transcript: readyTranscript,
      segments: [segment],
      nextCursor: 'not a cursor',
    },
    {
      transcript: readyTranscript,
      segments: [segment],
      rawLastEvaluatedKey: {},
    },
  ])('rejects an inconsistent or malformed GET response', (input) => {
    expect(transcriptWithSegmentsSchema.safeParse(input).success).toBe(false);
  });
});
