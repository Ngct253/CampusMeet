import { randomUUID } from 'node:crypto';
import type {
  AIWorkerPayload,
  Citation,
  ConversationMessage,
  GroundedAnswer,
  KnowledgeSource,
  KnowledgeSourceType,
  TaskProposal,
} from '@campusmeet/shared';
import {
  groundedAnswerSchema,
  groupProgressAnalysisSchema,
  minutesDraftSchema,
  taskProposalSchema,
} from '@campusmeet/shared';
import type {
  AIJobRepository,
  ApprovedSourceReader,
  ConversationRepository,
  DocumentNormalizer,
  GroundedGenerator,
  GroupProgressSnapshotReader,
  KnowledgeBaseIngestionGateway,
  KnowledgeRetriever,
  KnowledgeSourceRepository,
  SourceChunk,
  SourceObjectStore,
  TaskProposalGateway,
} from '../domain/ports';

export interface ExecutionDependencies {
  jobs: AIJobRepository;
  retriever: KnowledgeRetriever;
  liveSources: ApprovedSourceReader;
  generator: GroundedGenerator;
  conversations: ConversationRepository;
  proposals: TaskProposalGateway;
  progressSnapshots: GroupProgressSnapshotReader;
  objects: SourceObjectStore;
  knowledgeSources: KnowledgeSourceRepository;
  ingestion: KnowledgeBaseIngestionGateway;
  normalizer: DocumentNormalizer;
}

const safeErrorCode = (error: unknown) => {
  if (error instanceof Error && /^[A-Z][A-Z0-9_]{2,80}$/.test(error.message)) return error.message;
  return 'AI_WORKER_FAILED';
};

const indexedSourceTypes: KnowledgeSourceType[] = ['ATTACHMENT', 'TRANSCRIPT', 'MINUTES'];

const validateIndexedChunks = (
  chunks: SourceChunk[],
  expected: { groupId: string; meetingIds?: string[] },
) => {
  const meetingIds = expected.meetingIds ? new Set(expected.meetingIds) : undefined;
  for (const chunk of chunks) {
    if (!chunk.text.trim()) throw new Error('INVALID_RETRIEVAL_RESULT');
    if (chunk.citation.groupId !== expected.groupId) throw new Error('CROSS_GROUP_RETRIEVAL');
    if (meetingIds && !meetingIds.has(chunk.citation.meetingId)) {
      throw new Error('CROSS_MEETING_RETRIEVAL');
    }
    if (
      chunk.provenance.kind !== 'INDEXED' ||
      !chunk.provenance.approved ||
      chunk.provenance.ingestionStatus !== 'READY'
    ) {
      throw new Error('UNAPPROVED_RETRIEVAL_RESULT');
    }
  }
};

const validateFinalLiveChunks = (chunks: SourceChunk[], groupId: string, meetingId: string) => {
  for (const chunk of chunks) {
    if (!chunk.text.trim()) throw new Error('INVALID_LIVE_TRANSCRIPT_SEGMENT');
    if (chunk.citation.groupId !== groupId) throw new Error('CROSS_GROUP_RETRIEVAL');
    if (chunk.citation.meetingId !== meetingId) throw new Error('CROSS_MEETING_RETRIEVAL');
    if (chunk.citation.sourceType !== 'TRANSCRIPT') throw new Error('INVALID_LIVE_SOURCE_TYPE');
    if (chunk.provenance.kind !== 'LIVE_TRANSCRIPT' || !chunk.provenance.isFinal) {
      throw new Error('PARTIAL_TRANSCRIPT_SEGMENT');
    }
  }
};

const canonicalizeCitations = (citations: Citation[], chunks: SourceChunk[]): Citation[] => {
  const allowed = new Map(chunks.map((chunk) => [chunk.citation.citationId, chunk.citation]));
  return citations.map((citation) => {
    const canonical = allowed.get(citation.citationId);
    if (!canonical) throw new Error('UNGROUNDED_MODEL_OUTPUT');
    return canonical;
  });
};

const requireSources = (chunks: SourceChunk[]) => {
  if (!chunks.length) throw new Error('INSUFFICIENT_CONTEXT');
};

export class AIExecutionService {
  constructor(private readonly dependencies: ExecutionDependencies) {}

  async execute(aiJobId: string): Promise<unknown> {
    const record = await this.dependencies.jobs.get(aiJobId);
    if (!record) throw new Error('AI_JOB_NOT_FOUND');
    if (record.job.status === 'COMPLETED') return record.result;
    if (record.job.status === 'CANCELLED') throw new Error('AI_JOB_CANCELLED');

    await this.dependencies.jobs.markProcessing(aiJobId);
    try {
      if (record.payload.operation === 'INGEST_SOURCE') {
        return await this.prepareKnowledgeSource(aiJobId, record.payload);
      }
      const result = await this.generate(record.payload);
      await this.dependencies.jobs.markCompleted(aiJobId, result);
      return result;
    } catch (error) {
      await this.dependencies.jobs.markFailed(aiJobId, safeErrorCode(error));
      throw error;
    }
  }

  async checkIngestion(aiJobId: string, ingestionJobId: string): Promise<unknown> {
    const record = await this.dependencies.jobs.get(aiJobId);
    if (!record) throw new Error('AI_JOB_NOT_FOUND');
    if (record.payload.operation !== 'INGEST_SOURCE') throw new Error('INVALID_INGESTION_JOB');
    const status = await this.dependencies.ingestion.status(ingestionJobId);
    if (status === 'FAILED') {
      await this.dependencies.knowledgeSources.markIngestionStatus(
        record.payload.sourceId,
        record.payload.sourceVersion,
        'FAILED',
      );
      await this.dependencies.jobs.markFailed(aiJobId, 'KNOWLEDGE_BASE_INGESTION_FAILED');
      throw new Error('KNOWLEDGE_BASE_INGESTION_FAILED');
    }
    if (status !== 'COMPLETE') return { pending: true, ingestionJobId, status };
    await this.dependencies.knowledgeSources.markIngestionStatus(
      record.payload.sourceId,
      record.payload.sourceVersion,
      'READY',
    );
    const result = { pending: false, ingestionJobId, status };
    await this.dependencies.jobs.markCompleted(aiJobId, result);
    return result;
  }

  private async generate(payload: Exclude<AIWorkerPayload, { operation: 'INGEST_SOURCE' }>) {
    switch (payload.operation) {
      case 'MEETING_CHAT': {
        const lateJoin = payload.request.intent === 'LATE_JOIN_SUMMARY';
        const liveChunks = await this.dependencies.liveSources.getFinalLiveSegments(
          payload.meetingId,
          payload.groupId,
        );
        validateFinalLiveChunks(liveChunks, payload.groupId, payload.meetingId);
        const retrievalRequest = {
          question: payload.request.question,
          groupId: payload.groupId,
          scope: 'CURRENT_MEETING' as const,
          meetingIds: [payload.meetingId],
          approvedOnly: true as const,
          ingestionStatus: 'READY' as const,
          sourceTypes: indexedSourceTypes,
        };
        const indexedChunks = lateJoin
          ? []
          : await this.dependencies.retriever.retrieve(retrievalRequest);
        validateIndexedChunks(indexedChunks, {
          groupId: payload.groupId,
          meetingIds: [payload.meetingId],
        });
        const chunks = [...indexedChunks, ...liveChunks];
        const answer = chunks.length
          ? await this.dependencies.generator.answer({
              question: payload.request.question,
              scope: 'CURRENT_MEETING',
              chunks,
              lateJoin,
            })
          : ({
              answer: 'Không có đủ nguồn trong cuộc họp để trả lời câu hỏi này.',
              citations: [],
              scope: 'CURRENT_MEETING',
              insufficientContext: true,
            } satisfies GroundedAnswer);
        answer.scope = 'CURRENT_MEETING';
        answer.citations = canonicalizeCitations(answer.citations, chunks);
        if (!answer.insufficientContext && answer.citations.length === 0) {
          throw new Error('UNGROUNDED_MODEL_OUTPUT');
        }
        const validated = groundedAnswerSchema.parse(answer);
        await this.saveConversation(payload, validated);
        return validated;
      }
      case 'GROUP_SEARCH': {
        const retrievalRequest = {
          question: payload.request.question,
          groupId: payload.groupId,
          scope: payload.request.scope,
          ...(payload.request.meetingIds ? { meetingIds: payload.request.meetingIds } : {}),
          approvedOnly: true as const,
          ingestionStatus: 'READY' as const,
          sourceTypes: indexedSourceTypes,
        };
        const chunks = await this.dependencies.retriever.retrieve(retrievalRequest);
        validateIndexedChunks(chunks, {
          groupId: payload.groupId,
          ...(payload.request.meetingIds ? { meetingIds: payload.request.meetingIds } : {}),
        });
        const answer = chunks.length
          ? await this.dependencies.generator.answer({
              question: payload.request.question,
              scope: payload.request.scope,
              chunks,
              lateJoin: false,
            })
          : ({
              answer: 'Không có đủ nguồn đã duyệt trong nhóm để trả lời câu hỏi này.',
              citations: [],
              scope: payload.request.scope,
              insufficientContext: true,
            } satisfies GroundedAnswer);
        answer.scope = payload.request.scope;
        answer.citations = canonicalizeCitations(answer.citations, chunks);
        if (!answer.insufficientContext && answer.citations.length === 0) {
          throw new Error('UNGROUNDED_MODEL_OUTPUT');
        }
        const validated = groundedAnswerSchema.parse(answer);
        await this.saveConversation(payload, validated);
        return validated;
      }
      case 'MINUTES_DRAFT': {
        const retrievalRequest = {
          question: 'Diễn biến, chủ đề, quyết định và action item đã được nêu trong cuộc họp',
          groupId: payload.groupId,
          scope: 'CURRENT_MEETING' as const,
          meetingIds: [payload.meetingId],
          approvedOnly: true as const,
          ingestionStatus: 'READY' as const,
          sourceTypes: indexedSourceTypes,
        };
        const chunks = await this.dependencies.retriever.retrieve(retrievalRequest);
        validateIndexedChunks(chunks, {
          groupId: payload.groupId,
          meetingIds: [payload.meetingId],
        });
        requireSources(chunks);
        const draft = await this.dependencies.generator.minutes({
          meetingId: payload.meetingId,
          chunks,
        });
        draft.meetingId = payload.meetingId;
        draft.citations = canonicalizeCitations(draft.citations, chunks);
        for (const statement of [...draft.topics, ...draft.decisions, ...draft.actionItems]) {
          statement.citations = canonicalizeCitations(statement.citations, chunks);
        }
        return minutesDraftSchema.parse(draft);
      }
      case 'TASK_PROPOSALS': {
        const retrievalRequest = {
          question: 'Các action item hoặc công việc đã được nêu rõ trong cuộc họp',
          groupId: payload.groupId,
          scope: 'CURRENT_MEETING' as const,
          meetingIds: [payload.meetingId],
          approvedOnly: true as const,
          ingestionStatus: 'READY' as const,
          sourceTypes: indexedSourceTypes,
        };
        const chunks = await this.dependencies.retriever.retrieve(retrievalRequest);
        validateIndexedChunks(chunks, {
          groupId: payload.groupId,
          meetingIds: [payload.meetingId],
        });
        requireSources(chunks);
        const proposals = await this.dependencies.generator.taskProposals({
          groupId: payload.groupId,
          meetingId: payload.meetingId,
          chunks,
        });
        const normalized = proposals.map((proposal): TaskProposal => {
          const missingFields: TaskProposal['missingFields'] = [];
          if (!proposal.assigneeId) missingFields.push('assigneeId');
          if (!proposal.priority) missingFields.push('priority');
          return taskProposalSchema.parse({
            ...proposal,
            proposalId: `proposal_${randomUUID()}`,
            groupId: payload.groupId,
            meetingId: payload.meetingId,
            status: 'PENDING',
            missingFields,
            citations: canonicalizeCitations(proposal.citations, chunks),
          });
        });
        await this.dependencies.proposals.save(normalized, payload.actorId);
        return normalized;
      }
      case 'PROGRESS_ANALYSIS': {
        if (payload.request.snapshotVersion === undefined) {
          throw new Error('GROUP_PROGRESS_SNAPSHOT_VERSION_REQUIRED');
        }
        const snapshot = await this.dependencies.progressSnapshots.get(
          payload.groupId,
          payload.request.snapshotVersion,
        );
        if (snapshot.groupId !== payload.groupId) throw new Error('CROSS_GROUP_SNAPSHOT');
        const analysis = await this.dependencies.generator.progress(snapshot);
        return groupProgressAnalysisSchema.parse({
          ...analysis,
          groupId: payload.groupId,
          generatedAt: new Date().toISOString(),
        });
      }
    }
  }

  private async saveConversation(
    payload: Extract<AIWorkerPayload, { operation: 'MEETING_CHAT' | 'GROUP_SEARCH' }>,
    answer: GroundedAnswer,
  ) {
    const now = new Date().toISOString();
    const conversationId = payload.request.conversationId ?? `conversation_${randomUUID()}`;
    const question: ConversationMessage = {
      messageId: `message_${randomUUID()}`,
      conversationId,
      role: 'USER',
      content: payload.request.question,
      citations: [],
      createdAt: now,
    };
    const response: ConversationMessage = {
      messageId: `message_${randomUUID()}`,
      conversationId,
      role: 'ASSISTANT',
      content: answer.answer,
      citations: answer.citations,
      createdAt: now,
    };
    await this.dependencies.conversations.saveExchange({
      conversation: {
        conversationId,
        groupId: payload.groupId,
        ...(payload.operation === 'MEETING_CHAT' ? { meetingId: payload.meetingId } : {}),
        userId: payload.actorId,
        scope: answer.scope,
        updatedAt: now,
      },
      question,
      answer: response,
    });
  }

  private async prepareKnowledgeSource(
    aiJobId: string,
    payload: Extract<AIWorkerPayload, { operation: 'INGEST_SOURCE' }>,
  ) {
    const raw = await this.dependencies.objects.read(payload.inputObjectKey);
    const text = (await this.dependencies.normalizer.normalize(raw, payload.contentType)).trim();
    if (!text) throw new Error('EMPTY_NORMALIZED_SOURCE');
    const normalizedObjectKey = `kb/${payload.groupId}/${payload.meetingId}/${payload.sourceId}/v${payload.sourceVersion}/content.txt`;
    await this.dependencies.objects.writeNormalized({
      key: normalizedObjectKey,
      text,
      metadata: {
        groupId: payload.groupId,
        meetingId: payload.meetingId,
        sourceType: payload.sourceType,
        sourceId: payload.sourceId,
        version: payload.sourceVersion,
        approved: true,
        ingestionStatus: 'READY',
      },
    });
    const now = new Date().toISOString();
    const source: KnowledgeSource = {
      sourceId: payload.sourceId,
      groupId: payload.groupId,
      meetingId: payload.meetingId,
      sourceType: payload.sourceType,
      version: payload.sourceVersion,
      approved: true,
      ingestionStatus: 'PROCESSING',
      normalizedObjectKey,
      createdAt: now,
      updatedAt: now,
    };
    await this.dependencies.knowledgeSources.saveVersion(source);
    const staleObjectKeys = await this.dependencies.knowledgeSources.markOlderVersionsStale(
      payload.sourceId,
      payload.sourceVersion,
    );
    await Promise.all(
      staleObjectKeys.map((key) => this.dependencies.objects.deleteNormalized(key)),
    );
    const ingestionJobId = await this.dependencies.ingestion.start(aiJobId);
    return { pending: true, ingestionJobId, source };
  }
}
