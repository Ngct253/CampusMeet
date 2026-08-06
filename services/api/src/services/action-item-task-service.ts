import {
  GroupRole,
  MeetingStatus,
  type ConvertActionItemToTaskRequest,
  type ConvertActionItemToTaskResponse,
} from '@campusmeet/shared';
import type {
  ActionItemTaskRepository,
  MeetingRepository,
  MembershipAuthorizer,
  MinutesRepository,
} from '../domain/ports';
import {
  ConflictError,
  ForbiddenError,
  ResourceNotFoundError,
  UnprocessableEntityError,
} from '../utils/errors';

type MeetingReader = Pick<MeetingRepository, 'getById'>;
type MembershipReader = Pick<MembershipAuthorizer, 'getMembership'>;

const validateLinkedTask = (
  taskId: string,
  meetingId: string,
  actionItemId: string,
  task: Awaited<ReturnType<ActionItemTaskRepository['getTaskById']>>,
) => {
  if (
    !task ||
    task.id !== taskId ||
    task.sourceMeetingId !== meetingId ||
    task.sourceActionItemId !== actionItemId
  ) {
    throw new Error('Malformed Action Item task link.');
  }
  return task;
};

export class ActionItemTaskService {
  constructor(
    private readonly meetings: MeetingReader,
    private readonly minutes: MinutesRepository,
    private readonly groups: MembershipReader,
    private readonly conversions: ActionItemTaskRepository,
  ) {}

  async convert(
    actorId: string,
    meetingId: string,
    actionItemId: string,
    input: ConvertActionItemToTaskRequest,
  ): Promise<ConvertActionItemToTaskResponse> {
    const meeting = await this.meetings.getById(meetingId);
    if (!meeting) throw new ResourceNotFoundError('Không tìm thấy cuộc họp.');

    const actorMembership = await this.groups.getMembership(meeting.groupId, actorId);
    if (!actorMembership?.active || actorMembership.role !== GroupRole.GROUP_ADMIN) {
      throw new ForbiddenError('Chỉ Quản trị viên nhóm được chuyển action item thành công việc.');
    }
    if (meeting.status === MeetingStatus.CANCELLED) {
      throw new UnprocessableEntityError(
        'Không thể chuyển action item của cuộc họp đã hủy thành công việc.',
      );
    }

    const minutes = await this.minutes.getLatest(meetingId);
    if (!minutes) throw new ResourceNotFoundError('Chưa có biên bản cho cuộc họp này.');
    if (minutes.groupId !== meeting.groupId || minutes.meetingId !== meeting.id) {
      throw new Error('Malformed meeting minutes item.');
    }

    const actionItem = minutes.actionItems.find(({ id }) => id === actionItemId);
    if (!actionItem) {
      throw new ResourceNotFoundError(
        'Không tìm thấy action item trong phiên bản biên bản mới nhất.',
      );
    }

    if (actionItem.taskId) {
      const task = validateLinkedTask(
        actionItem.taskId,
        meetingId,
        actionItemId,
        await this.conversions.getTaskById(actionItem.taskId),
      );
      return { task, minutes };
    }

    if (minutes.version !== input.expectedMinutesVersion) {
      throw new ConflictError('Biên bản đã được cập nhật bởi yêu cầu khác.');
    }
    if (minutes.version >= 999999) {
      throw new UnprocessableEntityError('Biên bản đã đạt giới hạn phiên bản.');
    }
    if (actionItem.assigneeId && input.assigneeId) {
      throw new UnprocessableEntityError(
        'Không được ghi đè người phụ trách đã lưu của action item.',
      );
    }

    const assigneeId = actionItem.assigneeId ?? input.assigneeId;
    if (!assigneeId) {
      throw new UnprocessableEntityError('Action item chưa có người phụ trách.');
    }
    const assigneeMembership = await this.groups.getMembership(meeting.groupId, assigneeId);
    if (!assigneeMembership?.active) {
      throw new UnprocessableEntityError(
        'Người phụ trách phải là thành viên đang hoạt động của nhóm.',
      );
    }

    if (!input.title && actionItem.content.length > 200) {
      throw new UnprocessableEntityError(
        'Nội dung action item vượt quá 200 ký tự; cần cung cấp tiêu đề công việc.',
      );
    }

    return this.conversions.create({
      actorId,
      meeting,
      minutes,
      actionItemId,
      title: input.title ?? actionItem.content,
      assigneeId,
      priority: input.priority,
    });
  }
}
