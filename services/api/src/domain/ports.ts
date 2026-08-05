import type {
  CreateTaskRequest,
  Group,
  Meeting,
  MeetingMinutes,
  Notification,
  Task,
  TaskStatus,
  UpdateMeetingMinutesRequest,
} from '@campusmeet/shared';

export interface GroupRepository {
  getById(id: string): Promise<Group | null>;
}
export interface MeetingRepository {
  getById(id: string): Promise<Meeting | null>;
}
export interface MinutesRepository {
  getLatest(meetingId: string): Promise<MeetingMinutes | null>;
  createVersion(
    meeting: Meeting,
    actorId: string,
    input: UpdateMeetingMinutesRequest,
    nextVersion: number,
    minutesId?: string,
  ): Promise<MeetingMinutes>;
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
