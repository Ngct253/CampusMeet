import type {
  AIJob,
  AIWorkerPayload,
  Citation,
  Conversation,
  ConversationMessage,
  GroundedAnswer,
  GroupProgressAnalysis,
  GroupProgressSnapshot,
  IngestionStatus,
  KnowledgeScope,
  KnowledgeSource,
  KnowledgeSourceType,
  MinutesDraft,
  TaskProposal,
} from '@campusmeet/shared';

export interface AIJobRecord {
  job: AIJob;
  payload: AIWorkerPayload;
  result?: unknown;
}

export interface AIJobUpdater {
  markProcessing(aiJobId: string): Promise<void>;
  markCompleted(aiJobId: string, result: unknown, usage?: ModelUsage): Promise<void>;
  markFailed(aiJobId: string, errorCode: string): Promise<void>;
}

export interface AIJobRepository extends AIJobUpdater {
  get(aiJobId: string): Promise<AIJobRecord | null>;
}

export type SourceProvenance =
  | {
      kind: 'INDEXED';
      approved: boolean;
      ingestionStatus: IngestionStatus;
    }
  | {
      kind: 'LIVE_TRANSCRIPT';
      isFinal: boolean;
    };

export interface SourceChunk {
  text: string;
  citation: Citation;
  provenance: SourceProvenance;
}

export interface RetrievalRequest {
  question: string;
  groupId: string;
  scope: KnowledgeScope;
  meetingIds?: string[];
  approvedOnly: true;
  ingestionStatus: 'READY';
  sourceTypes: KnowledgeSourceType[];
}

export interface KnowledgeRetriever {
  retrieve(request: RetrievalRequest): Promise<SourceChunk[]>;
}

export interface ApprovedSourceReader {
  getFinalLiveSegments(meetingId: string, groupId: string): Promise<SourceChunk[]>;
}

export interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface Generated<T> {
  value: T;
  usage?: ModelUsage;
}

export interface GroundedGenerator {
  answer(input: {
    question: string;
    scope: KnowledgeScope;
    chunks: SourceChunk[];
    lateJoin: boolean;
  }): Promise<Generated<GroundedAnswer>>;
  minutes(input: { meetingId: string; chunks: SourceChunk[] }): Promise<Generated<MinutesDraft>>;
  taskProposals(input: {
    groupId: string;
    meetingId: string;
    chunks: SourceChunk[];
  }): Promise<Generated<TaskProposal[]>>;
  progress(snapshot: GroupProgressSnapshot): Promise<Generated<GroupProgressAnalysis>>;
}

export interface ConversationRepository {
  saveExchange(input: {
    conversation: Conversation;
    question: ConversationMessage;
    answer: ConversationMessage;
  }): Promise<void>;
}

export interface TaskProposalGateway {
  save(proposals: TaskProposal[], actorId: string): Promise<void>;
}

export interface GroupProgressSnapshotReader {
  get(groupId: string, version: number): Promise<GroupProgressSnapshot>;
}

export interface SourceObjectStore {
  read(key: string): Promise<Uint8Array>;
  writeNormalized(input: {
    key: string;
    text: string;
    metadata: Record<string, string | number | boolean>;
  }): Promise<void>;
  deleteNormalized(key: string): Promise<void>;
}

export interface KnowledgeSourceRepository {
  saveVersion(source: KnowledgeSource): Promise<KnowledgeSource>;
  markOlderVersionsStale(sourceId: string, currentVersion: number): Promise<string[]>;
  markIngestionStatus(
    sourceId: string,
    version: number,
    status: Extract<IngestionStatus, 'READY' | 'FAILED'>,
  ): Promise<void>;
}

export interface KnowledgeBaseIngestionGateway {
  start(clientToken: string): Promise<string>;
  status(ingestionJobId: string): Promise<'STARTING' | 'IN_PROGRESS' | 'COMPLETE' | 'FAILED'>;
}

export interface DocumentNormalizer {
  normalize(content: Uint8Array, contentType: string): Promise<string>;
}

export interface PreparedKnowledgeSource {
  sourceId: string;
  groupId: string;
  meetingId: string;
  sourceType: KnowledgeSourceType;
  version: number;
  normalizedObjectKey: string;
}
