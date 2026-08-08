import { z } from 'zod';
import { aiJobSchema } from '../ai';

export const MAX_TRANSCRIPT_VERSION = 9_999_999_999;
export const TRANSCRIPT_VERSION_PADDING = 10;
export const MAX_TRANSCRIPT_SEQUENCE = 9_999_999_999;
export const TRANSCRIPT_SEQUENCE_PADDING = 10;

export const transcriptVersionSchema = z.number().int().min(1).max(MAX_TRANSCRIPT_VERSION);

export const transcriptStatusSchema = z.enum(['LIVE', 'FINALIZING', 'READY', 'APPROVED', 'FAILED']);
export type TranscriptStatus = z.infer<typeof transcriptStatusSchema>;

const transcriptIdSchema = z.string().trim().min(1);
const isoDateTimeSchema = z.string().datetime({ offset: true });
const languageCodeSchema = z.string().trim().min(1).max(35);
const speakerLabelSchema = z
  .string()
  .trim()
  .regex(/^Speaker [1-9]\d*$/);
const transcriptTextSchema = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0, 'Transcript text must not be blank.');

export const transcriptSchema = z
  .object({
    transcriptId: transcriptIdSchema,
    meetingId: transcriptIdSchema,
    groupId: transcriptIdSchema,
    status: transcriptStatusSchema,
    version: transcriptVersionSchema,
    approvedVersion: transcriptVersionSchema.optional(),
    approvedBy: transcriptIdSchema.optional(),
    approvedAt: isoDateTimeSchema.optional(),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  .strict()
  .superRefine((transcript, context) => {
    const approvalMetadata = [
      transcript.approvedVersion,
      transcript.approvedBy,
      transcript.approvedAt,
    ];
    const approvalFieldCount = approvalMetadata.filter((value) => value !== undefined).length;
    if (approvalFieldCount !== 0 && approvalFieldCount !== approvalMetadata.length) {
      context.addIssue({
        code: 'custom',
        path: ['approvedVersion'],
        message: 'Approval metadata must be present together.',
      });
    }
    if (
      transcript.approvedVersion !== undefined &&
      transcript.approvedVersion > transcript.version
    ) {
      context.addIssue({
        code: 'custom',
        path: ['approvedVersion'],
        message: 'approvedVersion cannot exceed the current version.',
      });
    }
    if (
      transcript.status === 'APPROVED' &&
      (approvalFieldCount !== approvalMetadata.length ||
        transcript.approvedVersion !== transcript.version)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['status'],
        message: 'APPROVED requires approval metadata for the current version.',
      });
    }
    if (
      transcript.status !== 'APPROVED' &&
      transcript.approvedVersion !== undefined &&
      transcript.approvedVersion >= transcript.version
    ) {
      context.addIssue({
        code: 'custom',
        path: ['approvedVersion'],
        message: 'An unapproved current version must be newer than approvedVersion.',
      });
    }
    if (
      transcript.approvedVersion !== undefined &&
      transcript.status !== 'READY' &&
      transcript.status !== 'APPROVED'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['status'],
        message: 'Only READY or APPROVED transcripts may carry approval metadata.',
      });
    }
  });
export type Transcript = z.infer<typeof transcriptSchema>;

export const transcriptSegmentSchema = z
  .object({
    segmentId: transcriptIdSchema,
    transcriptId: transcriptIdSchema,
    sequence: z.number().int().nonnegative().max(MAX_TRANSCRIPT_SEQUENCE),
    startMs: z.number().int().nonnegative(),
    endMs: z.number().int().nonnegative(),
    text: transcriptTextSchema,
    confidence: z.number().min(0).max(1),
    languageCode: languageCodeSchema,
    speakerLabel: speakerLabelSchema,
    isFinal: z.literal(true),
    version: transcriptVersionSchema,
    updatedBy: transcriptIdSchema.optional(),
    updatedAt: isoDateTimeSchema.optional(),
  })
  .strict()
  .superRefine((segment, context) => {
    if (segment.endMs < segment.startMs) {
      context.addIssue({
        code: 'custom',
        path: ['endMs'],
        message: 'endMs must be greater than or equal to startMs.',
      });
    }
  });
export type TranscriptSegment = z.infer<typeof transcriptSegmentSchema>;

export const updateTranscriptSegmentRequestSchema = z
  .object({
    expectedVersion: transcriptVersionSchema,
    text: transcriptTextSchema.optional(),
    speakerLabel: speakerLabelSchema.optional(),
    languageCode: languageCodeSchema.optional(),
  })
  .strict()
  .superRefine((request, context) => {
    if (
      request.text === undefined &&
      request.speakerLabel === undefined &&
      request.languageCode === undefined
    ) {
      context.addIssue({
        code: 'custom',
        path: [],
        message: 'At least one editable transcript segment field is required.',
      });
    }
  });
export type UpdateTranscriptSegmentRequest = z.infer<typeof updateTranscriptSegmentRequestSchema>;

export const approveTranscriptRequestSchema = z
  .object({
    expectedVersion: transcriptVersionSchema,
  })
  .strict();
export type ApproveTranscriptRequest = z.infer<typeof approveTranscriptRequestSchema>;

export const approveTranscriptResponseSchema = z
  .object({
    transcript: transcriptSchema,
    aiJob: aiJobSchema,
  })
  .strict();
export type ApproveTranscriptResponse = z.infer<typeof approveTranscriptResponseSchema>;

export const transcriptSegmentsCursorSchema = z
  .string()
  .trim()
  .min(1)
  .max(4096)
  .regex(/^[A-Za-z0-9_-]+$/);

export const transcriptWithSegmentsSchema = z
  .object({
    transcript: transcriptSchema.nullable(),
    segments: z.array(transcriptSegmentSchema),
    nextCursor: transcriptSegmentsCursorSchema.optional(),
  })
  .strict()
  .superRefine((response, context) => {
    if (response.transcript === null) {
      if (response.segments.length > 0) {
        context.addIssue({
          code: 'custom',
          path: ['segments'],
          message: 'Segments require a canonical transcript.',
        });
      }
      if (response.nextCursor !== undefined) {
        context.addIssue({
          code: 'custom',
          path: ['nextCursor'],
          message: 'A cursor requires a canonical transcript.',
        });
      }
      return;
    }

    for (const [index, segment] of response.segments.entries()) {
      if (segment.transcriptId !== response.transcript.transcriptId) {
        context.addIssue({
          code: 'custom',
          path: ['segments', index, 'transcriptId'],
          message: 'Segment does not belong to the canonical transcript.',
        });
      }
      if (segment.version > response.transcript.version) {
        context.addIssue({
          code: 'custom',
          path: ['segments', index, 'version'],
          message: 'Segment version cannot exceed the current transcript version.',
        });
      }
    }
  });
export type TranscriptWithSegments = z.infer<typeof transcriptWithSegmentsSchema>;
