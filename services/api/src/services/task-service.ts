import {
  GroupRole,
  TaskStatus,
  type CreateTaskRequest,
  type Task,
  type UpdateTaskStatusRequest,
} from '@campusmeet/shared';
import { requireGroupMembership } from '../middleware/authorization';
import type { MeetingAccessBoundary, TaskRepository } from '../domain/ports';
import type { DynamoDbCollaborationRepository } from '../repositories/collaboration';
import {
  ConflictError,
  ForbiddenError,
  ResourceNotFoundError,
  UnprocessableEntityError,
} from '../utils/errors';

type MembershipReader = Pick<DynamoDbCollaborationRepository, 'getMembership'>;
type MeetingReader = Pick<MeetingAccessBoundary, 'resolveMeetingGroup'>;

const allowedTransitions: Record<TaskStatus, readonly TaskStatus[]> = {
  [TaskStatus.TODO]: [TaskStatus.DOING, TaskStatus.DONE],
  [TaskStatus.DOING]: [TaskStatus.TODO, TaskStatus.DONE],
  [TaskStatus.DONE]: [TaskStatus.DOING],
};

export class TaskService {
  constructor(
    private readonly tasks: TaskRepository,
    private readonly groups: MembershipReader,
    private readonly meetings: MeetingReader,
  ) {}

  async createTask(
    actorId: string,
    input: CreateTaskRequest,
    idempotencyKey: string,
  ): Promise<Task> {
    await requireGroupMembership(actorId, input.groupId, GroupRole.GROUP_ADMIN);
    if (!(await this.groups.getMembership(input.groupId, input.assigneeId))) {
      throw new UnprocessableEntityError(
        'Người phụ trách phải là thành viên đang hoạt động của nhóm.',
      );
    }
    if (input.sourceMeetingId) {
      const meetingGroupId = await this.meetings.resolveMeetingGroup(input.sourceMeetingId);
      if (meetingGroupId !== input.groupId) {
        throw new ResourceNotFoundError('Không tìm thấy cuộc họp.');
      }
    }
    return this.tasks.create(actorId, input, idempotencyKey);
  }

  async updateTaskStatus(
    actorId: string,
    taskId: string,
    input: UpdateTaskStatusRequest,
  ): Promise<Task> {
    const task = await this.tasks.getById(taskId);
    if (!task) throw new ResourceNotFoundError('Không tìm thấy công việc.');

    const membership = await this.groups.getMembership(task.groupId, actorId);
    if (!membership || (actorId !== task.assigneeId && membership.role !== GroupRole.GROUP_ADMIN)) {
      throw new ForbiddenError('Bạn không có quyền cập nhật công việc này.');
    }

    const isLegacyVersion = task.version === undefined;
    const persistedVersion = task.version === undefined ? 0 : task.version;
    if (
      (task.version !== undefined && task.version < 1) ||
      persistedVersion !== input.expectedVersion
    ) {
      throw new ConflictError('Công việc đã được cập nhật bởi yêu cầu khác.');
    }
    if (task.status === input.status) return task;
    if (!allowedTransitions[task.status].includes(input.status)) {
      throw new UnprocessableEntityError('Không thể chuyển sang trạng thái công việc đã chọn.');
    }

    return this.tasks.updateStatus(
      task,
      actorId,
      input.status,
      input.expectedVersion,
      isLegacyVersion,
    );
  }
}
