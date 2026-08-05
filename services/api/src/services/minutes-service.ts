import {
  GroupRole,
  MeetingStatus,
  type MeetingMinutes,
  type UpdateMeetingMinutesRequest,
} from '@campusmeet/shared';
import type { MinutesRepository } from '../domain/ports';
import type { DynamoDbCollaborationRepository } from '../repositories/collaboration';
import type { DynamoDbMeetingRepository } from '../repositories/dynamodb';
import {
  ConflictError,
  ForbiddenError,
  ResourceNotFoundError,
  UnprocessableEntityError,
} from '../utils/errors';

type MembershipReader = Pick<DynamoDbCollaborationRepository, 'getMembership'>;
type MeetingReader = Pick<DynamoDbMeetingRepository, 'getById'>;

export class MinutesService {
  constructor(
    private readonly minutes: MinutesRepository,
    private readonly meetings: MeetingReader,
    private readonly groups: MembershipReader,
  ) {}

  private async meetingForActiveMember(actorId: string, meetingId: string) {
    const meeting = await this.meetings.getById(meetingId);
    if (!meeting) throw new ResourceNotFoundError('Không tìm thấy cuộc họp.');
    const membership = await this.groups.getMembership(meeting.groupId, actorId);
    if (!membership) throw new ForbiddenError('Bạn không phải thành viên của nhóm này.');
    return { meeting, membership };
  }

  async getLatest(actorId: string, meetingId: string): Promise<MeetingMinutes> {
    const { meeting } = await this.meetingForActiveMember(actorId, meetingId);
    const minutes = await this.minutes.getLatest(meetingId);
    if (!minutes) throw new ResourceNotFoundError('Chưa có biên bản cho cuộc họp này.');
    if (minutes.groupId !== meeting.groupId) throw new Error('Malformed meeting minutes item.');
    return minutes;
  }

  async update(
    actorId: string,
    meetingId: string,
    input: UpdateMeetingMinutesRequest,
  ): Promise<MeetingMinutes> {
    const { meeting, membership } = await this.meetingForActiveMember(actorId, meetingId);
    if (membership.role !== GroupRole.GROUP_ADMIN) {
      throw new ForbiddenError('Chỉ Quản trị viên nhóm được ghi biên bản.');
    }
    if (meeting.status === MeetingStatus.CANCELLED) {
      throw new UnprocessableEntityError('Không thể cập nhật biên bản của cuộc họp đã hủy.');
    }
    const assigneeIds = [
      ...new Set(input.actionItems.flatMap(({ assigneeId }) => assigneeId ?? [])),
    ];
    const assignees = await Promise.all(
      assigneeIds.map((assigneeId) => this.groups.getMembership(meeting.groupId, assigneeId)),
    );
    if (assignees.some((membership) => !membership)) {
      throw new UnprocessableEntityError(
        'Người phụ trách action item phải là thành viên đang hoạt động của nhóm.',
      );
    }

    const current = await this.minutes.getLatest(meetingId);
    if (current && current.groupId !== meeting.groupId) {
      throw new Error('Malformed meeting minutes item.');
    }
    const currentVersion = current?.version ?? 0;
    if (currentVersion !== input.expectedVersion) {
      throw new ConflictError('Biên bản đã được cập nhật bởi yêu cầu khác.');
    }
    if (currentVersion >= 999999) {
      throw new UnprocessableEntityError('Biên bản đã đạt giới hạn phiên bản.');
    }
    return this.minutes.createVersion(meeting, actorId, input, currentVersion + 1, current?.id);
  }
}
