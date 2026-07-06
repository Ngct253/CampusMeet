import type { Group, Meeting, Notification, Task } from '@campusmeet/shared';

export interface GroupRepository {
  getById(id: string): Promise<Group | null>;
}
export interface MeetingRepository {
  getById(id: string): Promise<Meeting | null>;
}
export interface TaskRepository {
  getById(id: string): Promise<Task | null>;
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
