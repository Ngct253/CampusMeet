import type { InvitationDetails, MeetingMinutes, Notification, Task, User, Group, Meeting } from '../types';
import type { Priority, TaskStatus } from '../enums';
import { z } from 'zod';

export const groupInputSchema = z.object({
  name: z.string().trim().min(2, 'Tên nhóm cần ít nhất 2 ký tự.').max(100),
  description: z.string().trim().max(500).optional(),
});
export const invitationInputSchema = z.object({
  email: z.string().trim().email('Email không hợp lệ.').max(254).transform((value) => value.toLowerCase()),
});
export const updateProfileSchema = z.object({
  displayName: z.string().trim().min(2, 'Tên hiển thị cần ít nhất 2 ký tự.').max(100),
  timezone: z.string().trim().min(1).max(64).refine((value) => {
    try {
      Intl.DateTimeFormat('vi-VN', { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, 'Múi giờ không hợp lệ.'),
  emailNotificationsEnabled: z.boolean(),
});

export interface CreateGroupRequest {
  name: string;
  description?: string;
}
export interface CreateInvitationRequest {
  email: string;
}
export interface CreateInvitationResponse {
  invitation: InvitationDetails;
  inviteToken: string;
}
export interface UpdateProfileRequest {
  displayName: string;
  timezone: string;
  emailNotificationsEnabled: boolean;
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
