import {
  GroupRole,
  type ConfirmTaskProposalRequest,
  type ConfirmTaskProposalResponse,
} from '@campusmeet/shared';
import type { TaskProposalConfirmationRepository, TaskRepository } from '../domain/ports';
import { requireGroupMembership } from '../middleware/authorization';
import { ConflictError, ResourceNotFoundError } from '../utils/errors';
import type { TaskService } from './task-service';

export class TaskProposalConfirmationService {
  constructor(
    private readonly proposals: TaskProposalConfirmationRepository,
    private readonly taskService: Pick<TaskService, 'createTask'>,
    private readonly tasks: Pick<TaskRepository, 'getById'>,
  ) {}

  async confirm(
    actorId: string,
    proposalId: string,
    input: ConfirmTaskProposalRequest,
    idempotencyKey: string,
  ): Promise<ConfirmTaskProposalResponse> {
    const proposal = await this.proposals.getById(proposalId);
    if (!proposal) throw new ResourceNotFoundError('Không tìm thấy đề xuất công việc.');
    await requireGroupMembership(actorId, proposal.groupId, GroupRole.GROUP_ADMIN);

    if (proposal.status === 'EXECUTED') {
      if (!proposal.taskId) throw new ConflictError('Đề xuất thiếu liên kết công việc đã tạo.');
      const task = await this.tasks.getById(proposal.taskId);
      if (!task) throw new ConflictError('Không tìm thấy công việc đã liên kết với đề xuất.');
      return { proposal, task };
    }
    if (proposal.status !== 'PENDING' && proposal.status !== 'CONFIRMED') {
      throw new ConflictError('Đề xuất công việc không còn có thể xác nhận.');
    }

    await this.proposals.claim(proposalId, actorId, idempotencyKey);
    const task = await this.taskService.createTask(
      actorId,
      {
        groupId: proposal.groupId,
        title: proposal.title,
        assigneeId: input.assigneeId,
        priority: input.priority,
        ...(proposal.dueAt ? { dueAt: proposal.dueAt } : {}),
        sourceMeetingId: proposal.meetingId,
      },
      `ai-task-proposal:${proposalId}`,
    );
    const executed = await this.proposals.markExecuted(
      proposalId,
      actorId,
      idempotencyKey,
      task.id,
    );
    return { proposal: executed, task };
  }
}
