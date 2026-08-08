import type { AIJob, AIJobType, AIWorkerPayload } from '@campusmeet/shared';

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
  enqueue(input: {
    actorId: string;
    groupId: string;
    meetingId?: string;
    idempotencyKey: string;
    requestId: string;
    type: AIJobType;
    payload: AIWorkerPayload;
  }): Promise<AIJob>;
}

export interface AIJobIdempotencyReader {
  findExisting(input: {
    actorId: string;
    groupId: string;
    operation: AIWorkerPayload['operation'];
    idempotencyKey: string;
  }): Promise<{ job: AIJob; payload: AIWorkerPayload } | null>;
}
