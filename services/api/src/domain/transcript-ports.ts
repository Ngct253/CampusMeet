import type {
  ApproveTranscriptRequest,
  Transcript,
  TranscriptSegment,
  TranscriptWithSegments,
  UpdateTranscriptSegmentRequest,
} from '@campusmeet/shared';
import type { PreparedAIJob } from '../ai/ports';

export type TranscriptApprovalHandoff = {
  transcriptId: string;
  meetingId: string;
  groupId: string;
  approvedVersion: number;
  artifactObjectKey: string;
  artifactChecksum: string;
  aiJobId: string;
  aiOperation: 'INGEST_SOURCE';
  aiJobType: 'INGEST_SOURCE';
  createdAt: string;
  updatedAt: string;
};

export interface TranscriptRepository {
  getCanonical(
    meetingId: string,
    groupId: string,
    limit: number,
    cursor?: string,
  ): Promise<TranscriptWithSegments>;
  getById(transcriptId: string): Promise<Transcript | null>;
  getAllSegments(transcriptId: string, version: number): Promise<TranscriptSegment[]>;
  getApprovalHandoff(
    transcriptId: string,
    version: number,
  ): Promise<TranscriptApprovalHandoff | null>;
  getApprovalIntent(
    actorId: string,
    idempotencyKey: string,
  ): Promise<{ transcriptId: string; expectedVersion: number } | null>;
  bindApprovalIntent(input: {
    actorId: string;
    idempotencyKey: string;
    transcriptId: string;
    expectedVersion: number;
    aiJobId: string;
  }): Promise<void>;
  approve(input: {
    transcript: Transcript;
    actorId: string;
    requestId: string;
    idempotencyKey: string;
    request: ApproveTranscriptRequest;
    artifactObjectKey: string;
    artifactChecksum: string;
    preparedJob: PreparedAIJob;
  }): Promise<{
    transcript: Transcript;
    handoff: TranscriptApprovalHandoff;
    created: boolean;
  }>;
  updateSegment(input: {
    transcript: Transcript;
    segmentId: string;
    actorId: string;
    update: UpdateTranscriptSegmentRequest;
  }): Promise<{ transcript: Transcript; segment: TranscriptSegment }>;
}
