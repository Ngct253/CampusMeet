import { GroupRole, MeetingStatus, type Meeting } from '@campusmeet/shared';
import type {
  MembershipAuthorizer,
  MembershipRecord,
  MeetingPage,
  MeetingRepository,
} from '../domain/ports';
import { MeetingError } from '../domain/meeting-errors';

export class InMemoryMembershipAuthorizer implements MembershipAuthorizer {
  constructor(private readonly records: MembershipRecord[] = []) {}
  getMembership(groupId: string, userId: string) {
    return Promise.resolve(
      this.records.find((r) => r.groupId === groupId && r.userId === userId) ?? null,
    );
  }
  add(groupId: string, userId: string, role = GroupRole.MEMBER, active = true) {
    this.records.push({ groupId, userId, role, active });
  }
}
export class InMemoryMeetingRepository implements MeetingRepository {
  private readonly records = new Map<string, Meeting>();
  create(meeting: Meeting) {
    if (this.records.has(meeting.id)) throw new MeetingError('CONFLICT', 'Cuộc họp đã tồn tại.');
    this.records.set(meeting.id, structuredClone(meeting));
    return Promise.resolve(structuredClone(meeting));
  }
  getById(id: string) {
    const value = this.records.get(id);
    return Promise.resolve(value ? structuredClone(value) : null);
  }
  resolveGroupId(id: string) {
    return Promise.resolve(this.records.get(id)?.groupId ?? null);
  }
  listByGroup(groupId: string, limit: number, cursor?: string): Promise<MeetingPage> {
    const all = [...this.records.values()]
      .filter((m) => m.groupId === groupId)
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.id.localeCompare(b.id));
    const start = cursor ? Number(Buffer.from(cursor, 'base64url').toString('utf8')) : 0;
    const items = all.slice(start, start + limit).map((m) => structuredClone(m));
    const next = start + items.length;
    return Promise.resolve({
      items,
      ...(next < all.length ? { nextCursor: Buffer.from(String(next)).toString('base64url') } : {}),
    });
  }
  update(meeting: Meeting, expectedVersion: number) {
    const current = this.records.get(meeting.id);
    if (!current) throw new MeetingError('NOT_FOUND', 'Không tìm thấy cuộc họp.');
    if (current.version !== expectedVersion)
      throw new MeetingError('CONFLICT', 'Meeting version đã thay đổi.');
    this.records.set(meeting.id, structuredClone(meeting));
    return Promise.resolve(structuredClone(meeting));
  }
  cancel(id: string, actorId: string, reason?: string, expectedVersion?: number) {
    const current = this.records.get(id);
    if (!current) throw new MeetingError('NOT_FOUND', 'Không tìm thấy cuộc họp.');
    if (current.status === MeetingStatus.CANCELLED)
      return Promise.resolve(structuredClone(current));
    if (current.status === MeetingStatus.COMPLETED)
      throw new MeetingError('VALIDATION_ERROR', 'Không thể hủy cuộc họp đã hoàn thành.');
    if (expectedVersion !== undefined && expectedVersion !== current.version)
      throw new MeetingError('CONFLICT', 'Meeting version đã thay đổi.');
    const now = new Date().toISOString();
    const next = {
      ...current,
      status: MeetingStatus.CANCELLED,
      cancelledAt: now,
      cancelledBy: actorId,
      ...(reason ? { cancellationReason: reason } : {}),
      updatedAt: now,
      updatedBy: actorId,
      version: current.version + 1,
    };
    this.records.set(id, next);
    return Promise.resolve(structuredClone(next));
  }
}
