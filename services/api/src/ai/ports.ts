import type { AIJob, AIJobType, AIWorkerPayload } from '@campusmeet/shared';
import type { TransactWriteCommandInput } from '@aws-sdk/lib-dynamodb';

export type PrepareAIJobInput = {
  groupId: string;
  meetingId?: string;
  requestId: string;
  type: AIJobType;
  payload: AIWorkerPayload;
};

export type PreparedAIJob = {
  aiJobId: string;
  job: AIJob;
  payload: AIWorkerPayload;
  persistenceContribution: NonNullable<TransactWriteCommandInput['TransactItems']>[number];
};

export interface MembershipAuthorizer {
  requireMember(actorId: string, groupId: string): Promise<void>;
  requireGroupAdmin(actorId: string, groupId: string): Promise<void>;
  requireMeetingOrganizerOrAdmin(actorId: string, meetingId: string): Promise<string>;
}

export interface MeetingScopeReader {
  getMeetingGroupId(meetingId: string): Promise<string>;
  requireMeetingsInGroup(meetingIds: string[], groupId: string): Promise<void>;
}

export interface AIJobOrchestrator {
  prepareJob(input: PrepareAIJobInput): PreparedAIJob;
  enqueue(input: {
    actorId: string;
    groupId: string;
    meetingId?: string;
    idempotencyKey: string;
    requestId: string;
    type: AIJobType;
    payload: AIWorkerPayload;
  }): Promise<AIJob>;
  ensureStarted(aiJobId: string): Promise<AIJob>;
}

export interface AIJobIdempotencyReader {
  findExisting(input: {
    actorId: string;
    groupId: string;
    operation: AIWorkerPayload['operation'];
    idempotencyKey: string;
  }): Promise<{ job: AIJob; payload: AIWorkerPayload } | null>;
}
