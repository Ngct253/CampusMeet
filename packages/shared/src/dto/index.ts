import type { AgendaItem, InvitationDetails, ISODateTime, MeetingMinutes, Meeting } from '../types';
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
  agenda: z
    .array(
      z.object({
        id: z.string().trim().min(1).optional(),
        order: z.number().int().nonnegative(),
        title: z.string().trim().min(1).max(200),
        description: z.string().trim().max(1000).optional(),
      }),
    )
    .max(99)
    .default([]),
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
export const updateMeetingInputSchema = meetingFieldsSchema.partial().extend({
  version: z.number().int().positive(),
});
export const cancelMeetingInputSchema = z.object({
  reason: z.string().trim().max(500).optional(),
  version: z.number().int().positive().optional(),
});

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
const minutesDecisionInputSchema = z
  .object({ content: z.string().trim().min(1).max(1000) })
  .strict();
const minutesActionItemInputSchema = z
  .object({
    id: z.string().trim().min(1).optional(),
    content: z.string().trim().min(1).max(1000),
    assigneeId: z.string().trim().min(1).optional(),
    dueAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict();
export const meetingMinutesInputSchema = z
  .object({
    summary: z.string().trim().min(1).max(2000),
    discussion: z.string().trim().max(10000),
    decisions: z.array(minutesDecisionInputSchema).max(50),
    actionItems: z.array(minutesActionItemInputSchema).max(100),
    expectedVersion: z.number().int().min(0).max(999999),
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
  agenda?: Array<{ id?: string; order: number; title: string; description?: string }>;
  startsAt: string;
  endsAt: string;
}
export type UpdateMeetingRequest = Partial<CreateMeetingRequest> & { version: number };
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
/** @deprecated Use UpdateMeetingMinutesRequest for the versioned meeting-scoped Minutes API. */
export interface CreateMinutesRequest {
  meetingId: string;
  summary: string;
  decisions: string[];
  actionItems: Array<{ content: string; assigneeId?: string }>;
}
export type UpdateMeetingMinutesRequest = z.infer<typeof meetingMinutesInputSchema>;
export type CreateTaskRequest = z.infer<typeof taskInputSchema>;
export type UpdateTaskStatusRequest = z.infer<typeof updateTaskStatusInputSchema>;
export interface DashboardTaskSummary {
  total: number;
  todo: number;
  doing: number;
  done: number;
  overdue: number;
}
export interface DashboardResponse {
  generatedAt: ISODateTime;
  tasks: DashboardTaskSummary;
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
/** @deprecated The versioned Minutes API returns ApiSuccessResponse<MeetingMinutes>. */
export interface MinutesResponse {
  minutes: MeetingMinutes;
}
