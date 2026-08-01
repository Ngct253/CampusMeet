import { randomUUID } from 'node:crypto';
import type {
  AIWorkerPayload,
  Citation,
  ConversationMessage,
  GroundedAnswer,
  KnowledgeSource,
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
    const status = await this.dependencies.ingestion.status(ingestionJobId);
    if (status === 'FAILED') {
      await this.dependencies.jobs.markFailed(aiJobId, 'KNOWLEDGE_BASE_INGESTION_FAILED');
      throw new Error('KNOWLEDGE_BASE_INGESTION_FAILED');
    }
    if (status !== 'COMPLETE') return { pending: true, ingestionJobId, status };
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
        const indexedChunks = lateJoin
          ? []
          : await this.dependencies.retriever.retrieve({
              question: payload.request.question,
              groupId: payload.groupId,
              scope: 'CURRENT_MEETING',
              meetingIds: [payload.meetingId],
              approvedOnly: true,
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
        answer.citations = canonicalizeCitations(answer.citations, chunks);
        const validated = groundedAnswerSchema.parse(answer);
        await this.saveConversation(payload, validated);
        return validated;
      }
      case 'GROUP_SEARCH': {
        const chunks = await this.dependencies.retriever.retrieve({
          question: payload.request.question,
          groupId: payload.groupId,
          scope: payload.request.scope,
          ...(payload.request.meetingIds ? { meetingIds: payload.request.meetingIds } : {}),
          approvedOnly: true,
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
        answer.citations = canonicalizeCitations(answer.citations, chunks);
        const validated = groundedAnswerSchema.parse(answer);
        await this.saveConversation(payload, validated);
        return validated;
      }
      case 'MINUTES_DRAFT': {
        const chunks = await this.dependencies.retriever.retrieve({
          question: 'Diễn biến, chủ đề, quyết định và action item đã được nêu trong cuộc họp',
          groupId: payload.groupId,
          scope: 'CURRENT_MEETING',
          meetingIds: [payload.meetingId],
          approvedOnly: true,
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
        const chunks = await this.dependencies.retriever.retrieve({
          question: 'Các action item hoặc công việc đã được nêu rõ trong cuộc họp',
          groupId: payload.groupId,
          scope: 'CURRENT_MEETING',
          meetingIds: [payload.meetingId],
          approvedOnly: true,
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
    await this.dependencies.knowledgeSources.markOlderVersionsStale(
      payload.sourceId,
      payload.sourceVersion,
    );
    const ingestionJobId = await this.dependencies.ingestion.start(aiJobId);
    return { pending: true, ingestionJobId, source };
  }
}
