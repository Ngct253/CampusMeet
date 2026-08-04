import type {
  InvitationDetails,
  MeetingMinutes,
  Notification,
  Task,
  User,
  Group,
  Meeting,
} from '../types';
import { Priority, TaskStatus } from '../enums';
import { z } from 'zod';

export const groupInputSchema = z.object({
  name: z.string().trim().min(2, 'Tên nhóm cần ít nhất 2 ký tự.').max(100),
  description: z.string().trim().max(500).optional(),
});
export const invitationInputSchema = z.object({
  email: z
    .string()
    .trim()
    .email('Email không hợp lệ.')
    .max(254)
    .transform((value) => value.toLowerCase()),
});
export const updateProfileSchema = z.object({
  displayName: z.string().trim().min(2, 'Tên hiển thị cần ít nhất 2 ký tự.').max(100),
  timezone: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .refine((value) => {
      try {
        Intl.DateTimeFormat('vi-VN', { timeZone: value });
        return true;
      } catch {
        return false;
      }
    }, 'Múi giờ không hợp lệ.'),
  emailNotificationsEnabled: z.boolean(),
});
const meetingFieldsSchema = z.object({
  title: z.string().trim().min(2, 'Tiêu đề cần ít nhất 2 ký tự.').max(150),
  description: z.string().trim().max(2000).optional(),
  attendeeIds: z.array(z.string().trim().min(1)).max(100).default([]),
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }),
});
export const meetingInputSchema = meetingFieldsSchema.superRefine((value, context) => {
  if (Date.parse(value.endsAt) <= Date.parse(value.startsAt)) {
    context.addIssue({
      code: 'custom',
      path: ['endsAt'],
      message: 'Thời gian kết thúc phải sau thời gian bắt đầu.',
    });
  }
});
export const updateMeetingInputSchema = meetingFieldsSchema.partial();
export const cancelMeetingInputSchema = z.object({ reason: z.string().trim().max(500).optional() });
export const taskInputSchema = z
  .object({
    groupId: z.string().trim().min(1),
    title: z.string().trim().min(1).max(200),
    assigneeId: z.string().trim().min(1),
    priority: z.nativeEnum(Priority),
    dueAt: z.string().datetime({ offset: true }).optional(),
    sourceMeetingId: z.string().trim().min(1).optional(),
  })
  .strict();
export const updateTaskStatusInputSchema = z
  .object({
    status: z.nativeEnum(TaskStatus),
    expectedVersion: z.number().int().nonnegative(),
  })
  .strict();

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
  title: string;
  description?: string;
  attendeeIds: string[];
  startsAt: string;
  endsAt: string;
}
export type UpdateMeetingRequest = Partial<CreateMeetingRequest>;
export interface CancelMeetingRequest {
  reason?: string;
}
export interface CreateMinutesRequest {
  meetingId: string;
  summary: string;
  decisions: string[];
  actionItems: Array<{ content: string; assigneeId?: string }>;
}
export type CreateTaskRequest = z.infer<typeof taskInputSchema>;
export type UpdateTaskStatusRequest = z.infer<typeof updateTaskStatusInputSchema>;
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
