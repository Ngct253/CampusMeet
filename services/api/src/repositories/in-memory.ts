import {
  GoogleMeetingSyncStatus,
  GroupRole,
  MeetingStatus,
  type GoogleMeetingSyncRecord,
  type Meeting,
} from '@campusmeet/shared';
import type {
  MembershipAuthorizer,
  MembershipRecord,
  MeetingPage,
  MeetingRepository,
  GoogleMeetingSyncRepository,
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
export class InMemoryMeetingRepository implements MeetingRepository, GoogleMeetingSyncRepository {
  private readonly records = new Map<string, Meeting>();
  private readonly syncRecords = new Map<string, GoogleMeetingSyncRecord>();
  create(meeting: Meeting, sync?: GoogleMeetingSyncRecord) {
    if (this.records.has(meeting.id)) throw new MeetingError('CONFLICT', 'Cuộc họp đã tồn tại.');
    this.records.set(meeting.id, structuredClone(meeting));
    if (sync) this.syncRecords.set(meeting.id, structuredClone(sync));
    return Promise.resolve(structuredClone(meeting));
  }
  getById(id: string) {
    const value = this.records.get(id);
    return Promise.resolve(value ? structuredClone(value) : null);
  }
  resolveGroupId(id: string) {
    return Promise.resolve(this.records.get(id)?.groupId ?? null);
  }
  listByGroup(groupId: string, limit = 20, cursor?: string): Promise<MeetingPage> {
    const all = [...this.records.values()]
      .filter((m) => m.groupId === groupId)
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.id.localeCompare(b.id));
    let start = 0;
    if (cursor) {
      try {
        const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
          v?: number;
          groupId?: string;
          startsAt?: string;
          meetingId?: string;
        };
        if (value.v !== 1 || value.groupId !== groupId || !value.startsAt || !value.meetingId)
          throw new Error();
        const index = all.findIndex(
          (meeting) => meeting.startsAt === value.startsAt && meeting.id === value.meetingId,
        );
        if (index < 0) throw new Error();
        start = index + 1;
      } catch {
        throw new MeetingError(
          'VALIDATION_ERROR',
          'Cursor khÃ´ng há»£p lá»‡ hoáº·c khÃ´ng thuá»™c nhÃ³m.',
        );
      }
    }
    const items = all.slice(start, start + limit).map((m) => structuredClone(m));
    const next = start + items.length;
    const last = items.at(-1);
    return Promise.resolve({
      items,
      ...(next < all.length && last
        ? {
            nextCursor: Buffer.from(
              JSON.stringify({ v: 1, groupId, startsAt: last.startsAt, meetingId: last.id }),
            ).toString('base64url'),
          }
        : {}),
    });
  }
  update(
    meeting: Meeting,
    expectedVersion: number,
    sync?: GoogleMeetingSyncRecord,
    expectedSyncRevision?: number,
  ) {
    const current = this.records.get(meeting.id);
    if (!current) throw new MeetingError('NOT_FOUND', 'Không tìm thấy cuộc họp.');
    if (current.version !== expectedVersion)
      throw new MeetingError('CONFLICT', 'Meeting version đã thay đổi.');
    const currentSync = this.syncRecords.get(meeting.id);
    if (sync && currentSync?.syncRevision !== expectedSyncRevision)
      throw new MeetingError('CONFLICT', 'Google sync revision đã thay đổi.');
    this.records.set(meeting.id, structuredClone(meeting));
    if (sync) this.syncRecords.set(meeting.id, structuredClone(sync));
    return Promise.resolve(structuredClone(meeting));
  }
  cancel(
    id: string,
    actorId: string,
    reason?: string,
    expectedVersion?: number,
    sync?: GoogleMeetingSyncRecord,
    expectedSyncRevision?: number,
  ) {
    const current = this.records.get(id);
    if (!current) throw new MeetingError('NOT_FOUND', 'Không tìm thấy cuộc họp.');
    if (current.status === MeetingStatus.CANCELLED)
      return Promise.resolve(structuredClone(current));
    if (current.status === MeetingStatus.COMPLETED)
      throw new MeetingError('VALIDATION_ERROR', 'Không thể hủy cuộc họp đã hoàn thành.');
    if (expectedVersion !== undefined && expectedVersion !== current.version)
      throw new MeetingError('CONFLICT', 'Meeting version đã thay đổi.');
    const currentSync = this.syncRecords.get(id);
    if (sync && currentSync?.syncRevision !== expectedSyncRevision)
      throw new MeetingError('CONFLICT', 'Google sync revision đã thay đổi.');
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
    if (sync) this.syncRecords.set(id, structuredClone(sync));
    return Promise.resolve(structuredClone(next));
  }
  get(meetingId: string) {
    const sync = this.syncRecords.get(meetingId);
    return Promise.resolve(sync ? structuredClone(sync) : null);
  }
  createForLegacy(meeting: Meeting, now: string) {
    if (this.syncRecords.has(meeting.id))
      throw new MeetingError('CONFLICT', 'Google sync record đã được tạo.');
    const record: GoogleMeetingSyncRecord = {
      meetingId: meeting.id,
      groupId: meeting.groupId,
      organizerId: meeting.organizerId,
      provider: 'GOOGLE',
      syncStatus: GoogleMeetingSyncStatus.PENDING,
      syncRevision: 1,
      desiredMeetingVersion: meeting.version,
      desiredMeetingStatus: meeting.status,
      ...(meeting.googleEventId ? { googleEventId: meeting.googleEventId } : {}),
      ...(meeting.meetUrl ? { meetUrl: meeting.meetUrl } : {}),
      attemptCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    this.syncRecords.set(meeting.id, record);
    return Promise.resolve(structuredClone(record));
  }
  markSuccess(
    meetingId: string,
    syncRevision: number,
    result: { googleEventId?: string; meetUrl?: string; attemptCount: number },
  ) {
    const current = this.syncRecords.get(meetingId);
    if (!current || current.syncRevision !== syncRevision) return Promise.resolve(false);
    this.syncRecords.set(meetingId, {
      ...current,
      syncStatus: GoogleMeetingSyncStatus.SYNCED,
      ...result,
      failureClass: undefined,
      lastErrorCode: undefined,
      lastErrorAt: undefined,
      nextRetryAt: undefined,
      updatedAt: new Date().toISOString(),
    });
    return Promise.resolve(true);
  }
  markFailure(
    meetingId: string,
    syncRevision: number,
    failure: Parameters<GoogleMeetingSyncRepository['markFailure']>[2],
  ) {
    const current = this.syncRecords.get(meetingId);
    if (!current || current.syncRevision !== syncRevision) return Promise.resolve(false);
    this.syncRecords.set(meetingId, {
      ...current,
      syncStatus: failure.status,
      attemptCount: failure.attemptCount,
      failureClass: failure.failureClass,
      lastErrorCode: failure.lastErrorCode,
      lastErrorAt: failure.lastErrorAt,
      ...(failure.nextRetryAt ? { nextRetryAt: failure.nextRetryAt } : { nextRetryAt: undefined }),
      updatedAt: failure.lastErrorAt,
    });
    return Promise.resolve(true);
  }
  manualRetry(meeting: Meeting, expectedSyncRevision: number, now: string) {
    const current = this.syncRecords.get(meeting.id);
    if (!current || current.syncRevision !== expectedSyncRevision)
      throw new MeetingError('CONFLICT', 'Google sync revision đã thay đổi.');
    const next: GoogleMeetingSyncRecord = {
      ...current,
      syncStatus: GoogleMeetingSyncStatus.PENDING,
      syncRevision: current.syncRevision + 1,
      desiredMeetingVersion: meeting.version,
      desiredMeetingStatus: meeting.status,
      attemptCount: 0,
      failureClass: undefined,
      lastErrorCode: undefined,
      lastErrorAt: undefined,
      nextRetryAt: undefined,
      updatedAt: now,
    };
    this.syncRecords.set(meeting.id, next);
    return Promise.resolve(structuredClone(next));
  }
}
