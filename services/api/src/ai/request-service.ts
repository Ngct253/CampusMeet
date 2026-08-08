import type {
  AIJob,
  GenerateMeetingDraftRequest,
  GroupKnowledgeQuery,
  GroupProgressAnalysisRequest,
  MeetingChatRequest,
} from '@campusmeet/shared';
import type {
  AIJobIdempotencyReader,
  AIJobOrchestrator,
  MeetingScopeReader,
  MembershipAuthorizer,
} from './ports';
import type { GroupProgressSnapshotProvider } from '../domain/ports';

export class AIRequestService {
  constructor(
    private readonly access: MembershipAuthorizer,
    private readonly meetings: MeetingScopeReader,
    private readonly jobs: AIJobOrchestrator,
    private readonly snapshots: GroupProgressSnapshotProvider,
    private readonly jobReplays: AIJobIdempotencyReader,
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
    const groupId = await this.access.requireMeetingOrganizerOrAdmin(
      input.actorId,
      input.meetingId,
    );
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
    const groupId = await this.access.requireMeetingOrganizerOrAdmin(
      input.actorId,
      input.meetingId,
    );
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
    const existing = await this.jobReplays.findExisting({
      actorId: input.actorId,
      groupId: input.groupId,
      operation: 'PROGRESS_ANALYSIS',
      idempotencyKey: input.idempotencyKey,
    });
    if (existing) {
      if (
        existing.payload.operation !== 'PROGRESS_ANALYSIS' ||
        existing.payload.request.snapshotVersion === undefined
      ) {
        throw new Error('AI_IDEMPOTENCY_DATA_INTEGRITY');
      }
      return existing.job;
    }

    const snapshot = input.request.snapshotVersion
      ? await this.snapshots.getVersion(input.groupId, input.request.snapshotVersion)
      : await this.snapshots.generate(input.groupId);
    return this.jobs.enqueue({
      ...input,
      type: 'PROGRESS_ANALYSIS',
      payload: {
        operation: 'PROGRESS_ANALYSIS',
        actorId: input.actorId,
        groupId: input.groupId,
        request: { snapshotVersion: snapshot.version },
      },
    });
  }
}
