import {
  GoogleSyncStatus,
  GroupRole,
  IntegrationStatus,
  MeetingStatus,
  type CreateMeetingRequest,
  type Meeting,
  type UpdateMeetingRequest,
} from '@campusmeet/shared';
import type {
  MembershipAuthorizer,
  MeetingAccessBoundary,
  MeetingRepository,
} from '../domain/ports';
import {
  ConflictError,
  ForbiddenError,
  ResourceNotFoundError,
  UnprocessableEntityError,
} from '../utils/errors';

const validTimes = (startsAt: string, endsAt: string) => {
  if (Date.parse(endsAt) <= Date.parse(startsAt)) {
    throw new UnprocessableEntityError('Thời gian kết thúc phải sau thời gian bắt đầu.');
  }
};

const normalizeAgenda = (items: NonNullable<CreateMeetingRequest['agenda']> = []) => {
  const ids = new Set<string>();
  const orders = new Set<number>();
  return items
    .map((item) => {
      const id = item.id?.trim() || crypto.randomUUID();
      if (ids.has(id) || orders.has(item.order)) {
        throw new UnprocessableEntityError('Agenda id và thứ tự phải duy nhất.');
      }
      ids.add(id);
      orders.add(item.order);
      return {
        id,
        order: item.order,
        title: item.title.trim(),
        ...(item.description?.trim() ? { description: item.description.trim() } : {}),
      };
    })
    .sort((a, b) => a.order - b.order);
};

export class MeetingService implements MeetingAccessBoundary {
  constructor(
    private readonly meetings: MeetingRepository,
    private readonly memberships: MembershipAuthorizer,
    private readonly now: () => Date = () => new Date(),
    private readonly id: () => string = () => crypto.randomUUID(),
  ) {}

  private async requireMember(groupId: string, userId: string, admin = false) {
    const membership = await this.memberships.getMembership(groupId, userId);
    if (!membership?.active || (admin && membership.role !== GroupRole.GROUP_ADMIN)) {
      throw new ForbiddenError(
        admin
          ? 'Yêu cầu quyền Quản trị viên nhóm.'
          : 'Bạn không phải thành viên đang hoạt động của nhóm.',
      );
    }
  }

  private async requireMeeting(meetingId: string, actorId: string, admin = false) {
    const groupId = await this.meetings.resolveGroupId(meetingId);
    if (!groupId) throw new ResourceNotFoundError('Không tìm thấy cuộc họp.');
    await this.requireMember(groupId, actorId, admin);
    const meeting = await this.meetings.getById(meetingId);
    if (!meeting) throw new ResourceNotFoundError('Không tìm thấy cuộc họp.');
    return meeting;
  }

  async create(
    groupId: string,
    actorId: string,
    input: CreateMeetingRequest,
    meetingId = this.id(),
  ) {
    await this.requireMember(groupId, actorId, true);
    const attendeeIds = [actorId, ...input.attendeeIds.filter((id) => id !== actorId)];
    if (new Set(attendeeIds).size !== attendeeIds.length) {
      throw new UnprocessableEntityError('Không chấp nhận attendee trùng.');
    }
    for (const userId of attendeeIds) await this.requireMember(groupId, userId);
    validTimes(input.startsAt, input.endsAt);
    const now = this.now().toISOString();
    const meeting: Meeting = {
      id: meetingId,
      groupId,
      title: input.title.trim(),
      ...(input.description?.trim() ? { description: input.description.trim() } : {}),
      organizerId: actorId,
      attendeeIds,
      agenda: normalizeAgenda(input.agenda),
      startsAt: new Date(input.startsAt).toISOString(),
      endsAt: new Date(input.endsAt).toISOString(),
      status: MeetingStatus.SCHEDULED,
      googleSyncStatus: GoogleSyncStatus.NOT_REQUESTED,
      integrationStatus: IntegrationStatus.NOT_CONNECTED,
      createdAt: now,
      createdBy: actorId,
      updatedAt: now,
      updatedBy: actorId,
      version: 1,
    };
    return this.meetings.create(meeting);
  }

  async list(groupId: string, actorId: string) {
    await this.requireMember(groupId, actorId);
    return (await this.meetings.listByGroup(groupId)).items;
  }

  detail(meetingId: string, actorId: string) {
    return this.requireMeeting(meetingId, actorId);
  }

  async update(meetingId: string, input: UpdateMeetingRequest, actorId: string) {
    const current = await this.requireMeeting(meetingId, actorId, true);
    if (current.status === MeetingStatus.CANCELLED || current.status === MeetingStatus.COMPLETED) {
      throw new ConflictError('Không thể sửa cuộc họp đã kết thúc hoặc bị hủy.');
    }
    if (input.version !== undefined && input.version !== current.version) {
      throw new ConflictError('Phiên bản cuộc họp đã thay đổi.');
    }
    const attendeeIds = input.attendeeIds
      ? [current.organizerId, ...input.attendeeIds.filter((id) => id !== current.organizerId)]
      : current.attendeeIds;
    if (new Set(attendeeIds).size !== attendeeIds.length) {
      throw new UnprocessableEntityError('Không chấp nhận attendee trùng.');
    }
    for (const userId of attendeeIds) await this.requireMember(current.groupId, userId);
    const startsAt = input.startsAt ?? current.startsAt;
    const endsAt = input.endsAt ?? current.endsAt;
    validTimes(startsAt, endsAt);
    const next: Meeting = {
      ...current,
      ...(input.title === undefined ? {} : { title: input.title.trim() }),
      ...(input.description === undefined
        ? {}
        : { description: input.description.trim() || undefined }),
      attendeeIds,
      agenda: input.agenda === undefined ? current.agenda : normalizeAgenda(input.agenda),
      startsAt: new Date(startsAt).toISOString(),
      endsAt: new Date(endsAt).toISOString(),
      updatedAt: this.now().toISOString(),
      updatedBy: actorId,
      version: current.version + 1,
    };
    return this.meetings.update(next, current.version);
  }

  async cancel(
    meetingId: string,
    actorId: string,
    reason?: string,
    expectedVersion?: number,
  ) {
    const current = await this.requireMeeting(meetingId, actorId, true);
    if (current.status === MeetingStatus.CANCELLED) return current;
    if (expectedVersion !== undefined && expectedVersion !== current.version) {
      throw new ConflictError('Phiên bản cuộc họp đã thay đổi.');
    }
    return this.meetings.cancel(meetingId, actorId, reason?.trim() || undefined, current.version);
  }

  getMeeting(meetingId: string) {
    return this.meetings.getById(meetingId);
  }
  resolveMeetingGroup(meetingId: string) {
    return this.meetings.resolveGroupId(meetingId);
  }
  async canViewMeeting(meetingId: string, userId: string) {
    try {
      await this.requireMeeting(meetingId, userId);
      return true;
    } catch {
      return false;
    }
  }
}
