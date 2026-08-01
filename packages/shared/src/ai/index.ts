import { z } from 'zod';
import type { ISODateTime } from '../types';

export const aiJobStatusSchema = z.enum([
  'QUEUED',
  'PROCESSING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
]);
export type AIJobStatus = z.infer<typeof aiJobStatusSchema>;

export const aiJobTypeSchema = z.enum([
  'PARSE_DOCUMENT',
  'BATCH_TRANSCRIPTION',
  'INGEST_SOURCE',
  'GENERATE_ANSWER',
  'GENERATE_MINUTES',
  'GENERATE_TASK_PROPOSALS',
  'PROGRESS_ANALYSIS',
]);
export type AIJobType = z.infer<typeof aiJobTypeSchema>;

export const knowledgeScopeSchema = z.enum(['CURRENT_MEETING', 'SELECTED_MEETINGS', 'WHOLE_GROUP']);
export type KnowledgeScope = z.infer<typeof knowledgeScopeSchema>;

export const knowledgeSourceTypeSchema = z.enum(['ATTACHMENT', 'TRANSCRIPT', 'MINUTES']);
export type KnowledgeSourceType = z.infer<typeof knowledgeSourceTypeSchema>;

export const ingestionStatusSchema = z.enum(['PENDING', 'PROCESSING', 'READY', 'FAILED', 'STALE']);
export type IngestionStatus = z.infer<typeof ingestionStatusSchema>;

export const proposalStatusSchema = z.enum([
  'PENDING',
  'CONFIRMED',
  'EXECUTED',
  'REJECTED',
  'EXPIRED',
  'FAILED',
]);
export type ProposalStatus = z.infer<typeof proposalStatusSchema>;

export const citationSchema = z.object({
  citationId: z.string().min(1),
  groupId: z.string().min(1),
  meetingId: z.string().min(1),
  sourceType: knowledgeSourceTypeSchema,
  sourceId: z.string().min(1),
  sourceVersion: z.number().int().positive(),
  segmentId: z.string().min(1).optional(),
  speakerLabel: z
    .string()
    .regex(/^Speaker [1-9]\d*$/)
    .optional(),
  startMs: z.number().int().nonnegative().optional(),
  endMs: z.number().int().nonnegative().optional(),
  excerpt: z.string().max(500).optional(),
  internalUri: z.string().regex(/^campusmeet:\/\//),
});
export type Citation = z.infer<typeof citationSchema>;

export const aiJobSchema = z.object({
  aiJobId: z.string().min(1),
  groupId: z.string().min(1),
  meetingId: z.string().min(1).optional(),
  sourceId: z.string().min(1).optional(),
  type: aiJobTypeSchema,
  status: aiJobStatusSchema,
  attempt: z.number().int().nonnegative(),
  requestId: z.string().min(1),
  provider: z.enum(['AMAZON_TRANSCRIBE', 'BEDROCK']).optional(),
  inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
  estimatedCostUsd: z.number().nonnegative().optional(),
  errorCode: z.string().min(1).optional(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});
export type AIJob = z.infer<typeof aiJobSchema>;

export const knowledgeSourceSchema = z.object({
  sourceId: z.string().min(1),
  groupId: z.string().min(1),
  meetingId: z.string().min(1),
  sourceType: knowledgeSourceTypeSchema,
  version: z.number().int().positive(),
  approved: z.literal(true),
  ingestionStatus: ingestionStatusSchema,
  normalizedObjectKey: z.string().min(1),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});
export type KnowledgeSource = z.infer<typeof knowledgeSourceSchema>;

export interface Conversation {
  conversationId: string;
  groupId: string;
  meetingId?: string;
  userId: string;
  scope: KnowledgeScope;
  updatedAt: ISODateTime;
}

export interface ConversationMessage {
  messageId: string;
  conversationId: string;
  role: 'USER' | 'ASSISTANT';
  content: string;
  citations: Citation[];
  createdAt: ISODateTime;
}

export const groundedAnswerSchema = z.object({
  answer: z.string().min(1).max(20_000),
  citations: z.array(citationSchema).max(50),
  scope: knowledgeScopeSchema,
  insufficientContext: z.boolean(),
});
export type GroundedAnswer = z.infer<typeof groundedAnswerSchema>;

export const groundedStatementSchema = z.object({
  content: z.string().min(1).max(5_000),
  citations: z.array(citationSchema).min(1).max(20),
});
export type GroundedStatement = z.infer<typeof groundedStatementSchema>;

export const minutesDraftSchema = z.object({
  meetingId: z.string().min(1),
  summary: z.string().min(1).max(20_000),
  topics: z.array(groundedStatementSchema).max(100),
  decisions: z.array(groundedStatementSchema).max(100),
  actionItems: z.array(groundedStatementSchema).max(100),
  citations: z.array(citationSchema).min(1).max(100),
});
export type MinutesDraft = z.infer<typeof minutesDraftSchema>;

export const taskProposalSchema = z.object({
  proposalId: z.string().min(1),
  groupId: z.string().min(1),
  meetingId: z.string().min(1),
  title: z.string().min(1).max(200),
  description: z.string().max(5_000).optional(),
  assigneeId: z.string().min(1).optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH']).optional(),
  dueAt: z.string().datetime({ offset: true }).optional(),
  missingFields: z.array(z.enum(['assigneeId', 'priority'])),
  citations: z.array(citationSchema).min(1).max(20),
  status: proposalStatusSchema,
});
export type TaskProposal = z.infer<typeof taskProposalSchema>;

export const groupProgressSnapshotSchema = z.object({
  groupId: z.string().min(1),
  generatedAt: z.string().datetime({ offset: true }),
  taskCounts: z.object({
    total: z.number().int().nonnegative(),
    todo: z.number().int().nonnegative(),
    doing: z.number().int().nonnegative(),
    done: z.number().int().nonnegative(),
    overdue: z.number().int().nonnegative(),
  }),
  meetingCounts: z.object({
    completed: z.number().int().nonnegative(),
    upcoming: z.number().int().nonnegative(),
  }),
});
export type GroupProgressSnapshot = z.infer<typeof groupProgressSnapshotSchema>;

export const groupProgressAnalysisSchema = z.object({
  groupId: z.string().min(1),
  summary: z.string().min(1).max(10_000),
  observations: z.array(z.string().min(1).max(2_000)).max(50),
  risks: z.array(z.string().min(1).max(2_000)).max(50),
  generatedAt: z.string().datetime({ offset: true }),
});
export type GroupProgressAnalysis = z.infer<typeof groupProgressAnalysisSchema>;

export const meetingChatRequestSchema = z.object({
  question: z.string().trim().min(1).max(4_000),
  conversationId: z.string().min(1).optional(),
  intent: z.enum(['QUESTION_ANSWER', 'LATE_JOIN_SUMMARY']).default('QUESTION_ANSWER'),
});
export type MeetingChatRequest = z.infer<typeof meetingChatRequestSchema>;

export const groupKnowledgeQuerySchema = z
  .object({
    question: z.string().trim().min(1).max(4_000),
    scope: z.enum(['SELECTED_MEETINGS', 'WHOLE_GROUP']),
    meetingIds: z.array(z.string().min(1)).max(50).optional(),
    conversationId: z.string().min(1).optional(),
  })
  .superRefine((value, context) => {
    if (value.scope === 'SELECTED_MEETINGS' && !value.meetingIds?.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['meetingIds'],
        message: 'meetingIds is required for SELECTED_MEETINGS',
      });
    }
    if (value.scope === 'WHOLE_GROUP' && value.meetingIds?.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['meetingIds'],
        message: 'meetingIds is not allowed for WHOLE_GROUP',
      });
    }
  });
export type GroupKnowledgeQuery = z.infer<typeof groupKnowledgeQuerySchema>;

export const generateMeetingDraftRequestSchema = z.object({
  expectedTranscriptVersion: z.number().int().positive().optional(),
});
export type GenerateMeetingDraftRequest = z.infer<typeof generateMeetingDraftRequestSchema>;

export const groupProgressAnalysisRequestSchema = z
  .object({
    snapshotVersion: z.number().int().positive().optional(),
  })
  .strict();
export type GroupProgressAnalysisRequest = z.infer<typeof groupProgressAnalysisRequestSchema>;

export const aiRequestPayloadSchema = z.discriminatedUnion('operation', [
  z.object({
    operation: z.literal('MEETING_CHAT'),
    actorId: z.string().min(1),
    groupId: z.string().min(1),
    meetingId: z.string().min(1),
    request: meetingChatRequestSchema,
  }),
  z.object({
    operation: z.literal('GROUP_SEARCH'),
    actorId: z.string().min(1),
    groupId: z.string().min(1),
    request: groupKnowledgeQuerySchema,
  }),
  z.object({
    operation: z.literal('MINUTES_DRAFT'),
    actorId: z.string().min(1),
    groupId: z.string().min(1),
    meetingId: z.string().min(1),
    request: generateMeetingDraftRequestSchema,
  }),
  z.object({
    operation: z.literal('TASK_PROPOSALS'),
    actorId: z.string().min(1),
    groupId: z.string().min(1),
    meetingId: z.string().min(1),
    request: generateMeetingDraftRequestSchema,
  }),
  z.object({
    operation: z.literal('PROGRESS_ANALYSIS'),
    actorId: z.string().min(1),
    groupId: z.string().min(1),
    request: groupProgressAnalysisRequestSchema,
  }),
]);
export type AIRequestPayload = z.infer<typeof aiRequestPayloadSchema>;

export const supportedDocumentContentTypes = [
  'text/plain',
  'text/markdown',
  'text/csv',
  'text/tab-separated-values',
  'text/html',
  'text/calendar',
  'text/xml',
  'text/yaml',
  'text/x-yaml',
  'application/json',
  'application/x-ndjson',
  'application/ndjson',
  'application/xml',
  'application/xhtml+xml',
  'application/yaml',
  'application/x-yaml',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.oasis.opendocument.presentation',
  'application/vnd.oasis.opendocument.spreadsheet',
] as const;

export const documentContentTypeSchema = z
  .string()
  .transform((contentType) => contentType.split(';', 1)[0]!.trim().toLowerCase())
  .pipe(z.enum(supportedDocumentContentTypes));
export type DocumentContentType = z.infer<typeof documentContentTypeSchema>;

export const knowledgeIngestionPayloadSchema = z.object({
  operation: z.literal('INGEST_SOURCE'),
  actorId: z.string().min(1),
  groupId: z.string().min(1),
  meetingId: z.string().min(1),
  sourceId: z.string().min(1),
  sourceType: knowledgeSourceTypeSchema,
  sourceVersion: z.number().int().positive(),
  approved: z.literal(true),
  inputObjectKey: z.string().min(1),
  contentType: documentContentTypeSchema,
});
export type KnowledgeIngestionPayload = z.infer<typeof knowledgeIngestionPayloadSchema>;

export const aiWorkerPayloadSchema = z.union([
  aiRequestPayloadSchema,
  knowledgeIngestionPayloadSchema,
]);
export type AIWorkerPayload = z.infer<typeof aiWorkerPayloadSchema>;

export const aiWorkerEventSchema = z.object({
  aiJobId: z.string().min(1),
  action: z.enum(['EXECUTE', 'CHECK_INGESTION']).default('EXECUTE'),
  ingestionJobId: z.string().min(1).optional(),
});
export type AIWorkerEvent = z.infer<typeof aiWorkerEventSchema>;

export const groundedGenerationOutputSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('GROUNDED_ANSWER'), result: groundedAnswerSchema }),
  z.object({ kind: z.literal('MINUTES_DRAFT'), result: minutesDraftSchema }),
  z.object({ kind: z.literal('TASK_PROPOSALS'), result: z.array(taskProposalSchema) }),
  z.object({ kind: z.literal('PROGRESS_ANALYSIS'), result: groupProgressAnalysisSchema }),
]);
export type GroundedGenerationOutput = z.infer<typeof groundedGenerationOutputSchema>;
