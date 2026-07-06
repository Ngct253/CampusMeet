import type { MeetingMinutes, Notification, Task, User, Group, Meeting } from '../types';
import type { Priority, TaskStatus } from '../enums';

export interface CreateGroupRequest {
  name: string;
  description?: string;
}
export interface CreateInvitationRequest {
  groupId: string;
  email: string;
}
export interface CreateMeetingRequest {
  groupId: string;
  title: string;
  organizerId: string;
  attendeeIds: string[];
  startsAt: string;
  endsAt: string;
}
export type UpdateMeetingRequest = Partial<Omit<CreateMeetingRequest, 'groupId'>>;
export interface CancelMeetingRequest {
  reason?: string;
}
export interface CreateMinutesRequest {
  meetingId: string;
  summary: string;
  decisions: string[];
  actionItems: Array<{ content: string; assigneeId?: string }>;
}
export interface CreateTaskRequest {
  groupId: string;
  title: string;
  assigneeId: string;
  priority: Priority;
  dueAt?: string;
}
export interface UpdateTaskStatusRequest {
  status: TaskStatus;
}
export interface DashboardResponse {
  user: User;
  groups: Group[];
  upcomingMeetings: Meeting[];
  tasks: Task[];
  notifications: Notification[];
}
export interface ApiSuccessResponse<T> {
  success: true;
  data: T;
  requestId: string;
  isMock?: boolean;
}
export interface ApiErrorResponse {
  success: false;
  error: { code: string; message: string; details?: unknown };
  requestId: string;
  isMock?: boolean;
}
export interface MinutesResponse {
  minutes: MeetingMinutes;
}
