import {
  GoogleSyncStatus,
  GroupRole,
  MeetingStatus,
  type CreateMeetingRequest,
  type Meeting,
  type UpdateMeetingRequest,
} from '@campusmeet/shared';
import type {
  MembershipAuthorizer,
  MeetingAccessBoundary,
  MeetingPage,
  MeetingRepository,
} from '../domain/ports';
import { MeetingError } from '../domain/meeting-errors';

const text = (value: string | undefined, field: string) => {
  const result = value?.trim();
  if (!result) throw new MeetingError('VALIDATION_ERROR', `${field} là bắt buộc.`);
  return result;
};
const date = (value: string, field: string) => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf()))
    throw new MeetingError('VALIDATION_ERROR', `${field} không hợp lệ.`);
  return parsed.toISOString();
};
const validateTimes = (startsAt: string, endsAt: string, status: MeetingStatus) => {
  const start = date(startsAt, 'startsAt');
  const end = date(endsAt, 'endsAt');
  if (end <= start) throw new MeetingError('VALIDATION_ERROR', 'endsAt phải sau startsAt.');
  if (status === MeetingStatus.SCHEDULED && new Date(start).valueOf() <= Date.now())
    throw new MeetingError(
      'VALIDATION_ERROR',
      'Cuộc họp đã lên lịch phải bắt đầu trong tương lai.',
    );
  return { startsAt: start, endsAt: end };
};
const validatePeople = (organizerId: string, attendeeIds: string[]) => {
  text(organizerId, 'organizerId');
  if (new Set(attendeeIds).size !== attendeeIds.length)
    throw new MeetingError('VALIDATION_ERROR', 'Không chấp nhận attendee trùng.');
  if (attendeeIds.some((id) => !id.trim()))
    throw new MeetingError('VALIDATION_ERROR', 'attendeeId không hợp lệ.');
};
const agenda = (items: CreateMeetingRequest['agenda']) => {
  const ids = new Set<string>();
  const orders = new Set<number>();
  return items
    .map((item) => {
      if (!Number.isInteger(item.order) || item.order < 0 || orders.has(item.order))
        throw new MeetingError(
          'VALIDATION_ERROR',
          'Agenda order phải là số nguyên không âm và duy nhất.',
        );
      orders.add(item.order);
      const id = item.id?.trim() || crypto.randomUUID();
      if (ids.has(id)) throw new MeetingError('VALIDATION_ERROR', 'Agenda identity phải duy nhất.');
      ids.add(id);
      return {
        id,
        order: item.order,
        title: text(item.title, 'agenda.title'),
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
    if (!membership?.active || (admin && membership.role !== GroupRole.GROUP_ADMIN))
      throw new MeetingError(
        'FORBIDDEN',
        admin
          ? 'Yêu cầu quyền Quản trị viên nhóm.'
          : 'Bạn không phải thành viên đang hoạt động của nhóm.',
      );
  }
  private async requireMeeting(meetingId: string, userId: string, admin = false) {
    const groupId = await this.meetings.resolveGroupId(meetingId);
    if (!groupId) throw new MeetingError('NOT_FOUND', 'Không tìm thấy cuộc họp.');
    await this.requireMember(groupId, userId, admin);
    const meeting = await this.meetings.getById(meetingId);
    if (!meeting) throw new MeetingError('NOT_FOUND', 'Không tìm thấy cuộc họp.');
    return meeting;
  }
  async create(input: CreateMeetingRequest, actorId: string) {
    await this.requireMember(input.groupId, actorId, true);
    validatePeople(input.organizerId, input.attendeeIds);
    for (const userId of new Set([input.organizerId, ...input.attendeeIds]))
      await this.requireMember(input.groupId, userId);
    const times = validateTimes(input.startsAt, input.endsAt, input.status);
    const now = this.now().toISOString();
    const meeting: Meeting = {
      id: this.id(),
      groupId: input.groupId,
      title: text(input.title, 'title'),
      ...(input.description?.trim() ? { description: input.description.trim() } : {}),
      organizerId: input.organizerId,
      attendeeIds: [...input.attendeeIds],
      agenda: agenda(input.agenda),
      ...times,
      status: input.status,
      googleSyncStatus: GoogleSyncStatus.NOT_REQUESTED,
      createdAt: now,
      createdBy: actorId,
      updatedAt: now,
      updatedBy: actorId,
      version: 1,
    };
    return this.meetings.create(meeting);
  }
  async detail(meetingId: string, actorId: string) {
    return this.requireMeeting(meetingId, actorId);
  }
  async list(groupId: string, actorId: string, limit = 20, cursor?: string): Promise<MeetingPage> {
    await this.requireMember(groupId, actorId);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new MeetingError('VALIDATION_ERROR', 'limit phải từ 1 đến 100.');
    return this.meetings.listByGroup(groupId, limit, cursor);
  }
  async update(meetingId: string, input: UpdateMeetingRequest, actorId: string) {
    const current = await this.requireMeeting(meetingId, actorId, true);
    if (current.status === MeetingStatus.CANCELLED || current.status === MeetingStatus.COMPLETED)
      throw new MeetingError('VALIDATION_ERROR', 'Không thể sửa cuộc họp đã kết thúc hoặc bị hủy.');
    const status = input.status ?? current.status;
    if (status !== MeetingStatus.DRAFT && status !== MeetingStatus.SCHEDULED)
      throw new MeetingError('VALIDATION_ERROR', 'Chuyển trạng thái cuộc họp không hợp lệ.');
    const organizerId = input.organizerId ?? current.organizerId;
    const attendeeIds = input.attendeeIds ?? current.attendeeIds;
    validatePeople(organizerId, attendeeIds);
    for (const userId of new Set([organizerId, ...attendeeIds]))
      await this.requireMember(current.groupId, userId);
    const times = validateTimes(
      input.startsAt ?? current.startsAt,
      input.endsAt ?? current.endsAt,
      status,
    );
    const next: Meeting = {
      ...current,
      title: input.title === undefined ? current.title : text(input.title, 'title'),
      ...(input.description === undefined
        ? {}
        : { description: input.description.trim() || undefined }),
      organizerId,
      attendeeIds: [...attendeeIds],
      agenda: input.agenda ? agenda(input.agenda) : current.agenda,
      ...times,
      status,
      updatedAt: this.now().toISOString(),
      updatedBy: actorId,
      version: current.version + 1,
    };
    return this.meetings.update(next, input.version);
  }
  async cancel(meetingId: string, actorId: string, reason?: string, version?: number) {
    await this.requireMeeting(meetingId, actorId, true);
    return this.meetings.cancel(meetingId, actorId, reason?.trim() || undefined, version);
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
