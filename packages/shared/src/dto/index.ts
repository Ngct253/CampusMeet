import type {
  AgendaItem,
  MeetingMinutes,
  Notification,
  Task,
  User,
  Group,
  Meeting,
} from '../types';
import type { MeetingStatus, Priority, TaskStatus } from '../enums';

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
  description?: string;
  agenda: Array<{ id?: string; order: number; title: string; description?: string }>;
  startsAt: string;
  endsAt: string;
  status: MeetingStatus.DRAFT | MeetingStatus.SCHEDULED;
}
export type UpdateMeetingRequest = Partial<Omit<CreateMeetingRequest, 'groupId'>> & {
  version: number;
};
export interface CancelMeetingRequest {
  reason?: string;
  version?: number;
}
export interface MeetingResponse {
  meeting: Meeting;
}
export interface MeetingDetailResponse extends MeetingResponse {
  organizer: { userId: string };
  attendees: Array<{ userId: string }>;
  agenda: AgendaItem[];
}
export interface CursorPage<T> {
  items: T[];
  nextCursor?: string;
}
export type MeetingTimelineResponse = CursorPage<Meeting>;
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
