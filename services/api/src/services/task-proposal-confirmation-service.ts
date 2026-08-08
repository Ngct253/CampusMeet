import {
  GroupRole,
  Priority,
  type ConfirmTaskProposalRequest,
  type ConfirmTaskProposalResponse,
} from '@campusmeet/shared';
import type {
  MeetingRepository,
  MembershipAuthorizer,
  TaskProposalConfirmationRepository,
} from '../domain/ports';
import { ForbiddenError, ResourceNotFoundError, UnprocessableEntityError } from '../utils/errors';

type MeetingReader = Pick<MeetingRepository, 'getById'>;
type MembershipReader = Pick<MembershipAuthorizer, 'getMembership'>;

export class TaskProposalConfirmationService {
  constructor(
    private readonly proposals: TaskProposalConfirmationRepository,
    private readonly meetings: MeetingReader,
    private readonly groups: MembershipReader,
  ) {}

  async confirm(
    actorId: string,
    proposalId: string,
    input: ConfirmTaskProposalRequest,
  ): Promise<ConfirmTaskProposalResponse> {
    const proposal = await this.proposals.getById(proposalId);
    if (!proposal) throw new ResourceNotFoundError('Không tìm thấy đề xuất công việc.');

    const actorMembership = await this.groups.getMembership(proposal.groupId, actorId);
    if (!actorMembership?.active || actorMembership.role !== GroupRole.GROUP_ADMIN) {
      throw new ForbiddenError('Chỉ Quản trị viên nhóm được xác nhận đề xuất công việc.');
    }

    const meeting = await this.meetings.getById(proposal.meetingId);
    if (!meeting || meeting.groupId !== proposal.groupId) {
      throw new Error('TASK_PROPOSAL_DATA_INTEGRITY');
    }
    if (proposal.status === 'CONFIRMED') return this.proposals.getConfirmed(proposal);
    if (proposal.status !== 'PENDING') {
      throw new UnprocessableEntityError('Đề xuất công việc không thể được xác nhận.');
    }

    const title = input.title ?? proposal.title;
    const assigneeId = input.assigneeId ?? proposal.assigneeId;
    const priority = input.priority ?? (proposal.priority as Priority | undefined);
    if (!assigneeId || !priority) {
      throw new UnprocessableEntityError(
        'Đề xuất phải có người phụ trách và mức ưu tiên trước khi xác nhận.',
      );
    }
    const assigneeMembership = await this.groups.getMembership(proposal.groupId, assigneeId);
    if (!assigneeMembership?.active) {
      throw new UnprocessableEntityError(
        'Người phụ trách phải là thành viên đang hoạt động của nhóm.',
      );
    }

    const dueAt = input.dueAt ?? proposal.dueAt;
    return this.proposals.confirm({
      actorId,
      proposal,
      input: {
        title,
        assigneeId,
        priority,
        ...(dueAt ? { dueAt } : {}),
      },
    });
  }
}
