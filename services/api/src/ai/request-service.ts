import type {
  AIJob,
  GenerateMeetingDraftRequest,
  GroupKnowledgeQuery,
  GroupProgressAnalysisRequest,
  MeetingChatRequest,
} from '@campusmeet/shared';
import type { AIJobOrchestrator, MeetingScopeReader, MembershipAuthorizer } from './ports';

export class AIRequestService {
  constructor(
    private readonly access: MembershipAuthorizer,
    private readonly meetings: MeetingScopeReader,
    private readonly jobs: AIJobOrchestrator,
  ) {}

  async requestMeetingChat(input: {
    actorId: string;
    meetingId: string;
    request: MeetingChatRequest;
    idempotencyKey: string;
    requestId: string;
  }): Promise<AIJob> {
    const groupId = await this.meetings.getMeetingGroupId(input.meetingId);
    await this.access.requireMember(input.actorId, groupId);
    return this.jobs.enqueue({
      ...input,
      groupId,
      type: 'GENERATE_ANSWER',
      payload: {
        operation: 'MEETING_CHAT',
        actorId: input.actorId,
        groupId,
        meetingId: input.meetingId,
        request: input.request,
      },
    });
  }

  async requestGroupSearch(input: {
    actorId: string;
    groupId: string;
    request: GroupKnowledgeQuery;
    idempotencyKey: string;
    requestId: string;
  }): Promise<AIJob> {
    await this.access.requireMember(input.actorId, input.groupId);
    if (input.request.scope === 'SELECTED_MEETINGS') {
      await this.meetings.requireMeetingsInGroup(input.request.meetingIds ?? [], input.groupId);
    }
    return this.jobs.enqueue({
      ...input,
      type: 'GENERATE_ANSWER',
      payload: {
        operation: 'GROUP_SEARCH',
        actorId: input.actorId,
        groupId: input.groupId,
        request: input.request,
      },
    });
  }

  async requestMinutesDraft(input: {
    actorId: string;
    meetingId: string;
    request: GenerateMeetingDraftRequest;
    idempotencyKey: string;
    requestId: string;
  }): Promise<AIJob> {
    const groupId = await this.access.requireMeetingOrganizerOrAdmin(input.actorId, input.meetingId);
    return this.jobs.enqueue({
      ...input,
      groupId,
      type: 'GENERATE_MINUTES',
      payload: {
        operation: 'MINUTES_DRAFT',
        actorId: input.actorId,
        groupId,
        meetingId: input.meetingId,
        request: input.request,
      },
    });
  }

  async requestTaskProposals(input: {
    actorId: string;
    meetingId: string;
    request: GenerateMeetingDraftRequest;
    idempotencyKey: string;
    requestId: string;
  }): Promise<AIJob> {
    const groupId = await this.access.requireMeetingOrganizerOrAdmin(input.actorId, input.meetingId);
    return this.jobs.enqueue({
      ...input,
      groupId,
      type: 'GENERATE_TASK_PROPOSALS',
      payload: {
        operation: 'TASK_PROPOSALS',
        actorId: input.actorId,
        groupId,
        meetingId: input.meetingId,
        request: input.request,
      },
    });
  }

  async requestProgressAnalysis(input: {
    actorId: string;
    groupId: string;
    request: GroupProgressAnalysisRequest;
    idempotencyKey: string;
    requestId: string;
  }): Promise<AIJob> {
    await this.access.requireGroupAdmin(input.actorId, input.groupId);
    return this.jobs.enqueue({
      ...input,
      type: 'PROGRESS_ANALYSIS',
      payload: {
        operation: 'PROGRESS_ANALYSIS',
        actorId: input.actorId,
        groupId: input.groupId,
        request: input.request,
      },
    });
  }
}
