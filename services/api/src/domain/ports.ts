import type {
  CreateTaskRequest,
  Group,
  GroupRole,
  Meeting,
  Notification,
  Task,
  TaskStatus,
} from '@campusmeet/shared';

export interface GroupRepository {
  getById(id: string): Promise<Group | null>;
}
export interface MeetingRepository {
  create(meeting: Meeting): Promise<Meeting>;
  getById(id: string): Promise<Meeting | null>;
  resolveGroupId(id: string): Promise<string | null>;
  listByGroup(groupId: string, limit?: number, cursor?: string): Promise<MeetingPage>;
  update(meeting: Meeting, expectedVersion: number): Promise<Meeting>;
  cancel(
    id: string,
    actorId: string,
    reason: string | undefined,
    expectedVersion?: number,
  ): Promise<Meeting>;
}
export interface MeetingPage {
  items: Meeting[];
  nextCursor?: string;
}
export interface MembershipAuthorizer {
  getMembership(
    groupId: string,
    userId: string,
  ): Promise<{ groupId: string; userId: string; role: GroupRole; active: boolean } | null | undefined>;
}
export interface MembershipRecord {
  groupId: string;
  userId: string;
  role: GroupRole;
  active: boolean;
}
export interface MeetingAccessBoundary {
  getMeeting(meetingId: string): Promise<Meeting | null>;
  resolveMeetingGroup(meetingId: string): Promise<string | null>;
  canViewMeeting(meetingId: string, userId: string): Promise<boolean>;
}
export interface TaskRepository {
  listByAssignee(userId: string): Promise<Task[]>;
  getById(id: string): Promise<Task | undefined>;
  create(actorId: string, input: CreateTaskRequest, idempotencyKey: string): Promise<Task>;
  updateStatus(
    task: Task,
    actorId: string,
    status: TaskStatus,
    expectedVersion: number,
    isLegacyVersion: boolean,
  ): Promise<Task>;
}
export interface NotificationRepository {
  create(notification: Notification): Promise<void>;
}
export interface GoogleCalendarGateway {
  createEvent(meeting: Meeting): Promise<{ eventId: string; meetUrl?: string }>;
}
export interface ReminderSchedulerGateway {
  schedule(meeting: Meeting): Promise<{ scheduleId: string }>;
}
export interface EmailGateway {
  send(to: string, subject: string, body: string): Promise<void>;
}
export interface AuditLogGateway {
  record(action: string, resourceId: string, requestId: string): Promise<void>;
}
