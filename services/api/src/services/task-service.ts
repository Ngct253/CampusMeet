import { GroupRole, type CreateTaskRequest, type Task } from '@campusmeet/shared';
import { requireGroupMembership } from '../middleware/authorization';
import type { TaskRepository } from '../domain/ports';
import type { DynamoDbCollaborationRepository } from '../repositories/collaboration';
import type { DynamoDbMeetingRepository } from '../repositories/dynamodb';
import { ResourceNotFoundError, UnprocessableEntityError } from '../utils/errors';

type MembershipReader = Pick<DynamoDbCollaborationRepository, 'getMembership'>;
type MeetingReader = Pick<DynamoDbMeetingRepository, 'getById'>;

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
      const meeting = await this.meetings.getById(input.sourceMeetingId);
      if (!meeting || meeting.groupId !== input.groupId) {
        throw new ResourceNotFoundError('Không tìm thấy cuộc họp.');
      }
    }
    return this.tasks.create(actorId, input, idempotencyKey);
  }
}
