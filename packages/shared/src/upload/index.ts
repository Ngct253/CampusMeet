import { z } from 'zod';
import { aiJobSchema } from '../ai';
import type { ISODateTime } from '../types';

export const maxAttachmentsPerMeeting = 10;
export const maxAttachmentSizeBytes = 50 * 1024 * 1024;
export const maxAudioDurationMinutes = 60;

export const attachmentStatusSchema = z.enum([
  'PENDING_UPLOAD',
  'UPLOADED',
  'READY',
  'REJECTED',
  'EXPIRED',
]);
export type AttachmentStatus = z.infer<typeof attachmentStatusSchema>;

export const supportedUploadDocumentContentTypes = [
  'text/plain',
  'text/markdown',
  'text/csv',
  'text/tab-separated-values',
  'application/json',
  'application/x-ndjson',
  'text/html',
  'application/xhtml+xml',
  'application/xml',
  'text/yaml',
  'text/calendar',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.oasis.opendocument.presentation',
  'application/vnd.oasis.opendocument.spreadsheet',
] as const;

export const supportedUploadAudioContentTypes = [
  'audio/mpeg',
  'audio/wav',
  'audio/webm',
  'audio/mp4',
] as const;

export const supportedUploadAttachmentContentTypes = [
  ...supportedUploadDocumentContentTypes,
  ...supportedUploadAudioContentTypes,
] as const;

export const uploadAttachmentRequestSchema = z.object({
  meetingId: z.string().min(1),
  fileName: z.string().trim().min(1).max(255),
  contentType: z.enum(supportedUploadAttachmentContentTypes),
  sizeBytes: z.number().int().positive().max(maxAttachmentSizeBytes),
  checksum: z.string().trim().min(1).max(128),
});
export type UploadAttachmentRequest = z.infer<typeof uploadAttachmentRequestSchema>;

export const completeUploadRequestSchema = z.object({
  attachmentId: z.string().min(1),
  checksum: z.string().trim().min(1).max(128),
});
export type CompleteUploadRequest = z.infer<typeof completeUploadRequestSchema>;

export const attachmentSchema = z.object({
  attachmentId: z.string().min(1),
  meetingId: z.string().min(1),
  groupId: z.string().min(1),
  fileName: z.string().min(1).max(255),
  contentType: z.enum(supportedUploadAttachmentContentTypes),
  sizeBytes: z.number().int().positive().max(maxAttachmentSizeBytes),
  checksum: z.string().min(1).max(128),
  objectKey: z.string().min(1),
  status: attachmentStatusSchema,
  createdAt: z.string().datetime({ offset: true }) as z.ZodType<ISODateTime>,
  updatedAt: z.string().datetime({ offset: true }) as z.ZodType<ISODateTime>,
  readyAt: z.string().datetime({ offset: true }).optional() as z.ZodOptional<z.ZodType<ISODateTime>>,
  expiresAt: z.string().datetime({ offset: true }).optional() as z.ZodOptional<z.ZodType<ISODateTime>>,
});
export type Attachment = z.infer<typeof attachmentSchema>;

export const createUploadUrlResponseSchema = z.object({
  attachment: attachmentSchema,
  uploadUrl: z.string().url(),
  uploadExpiresAt: z.string().datetime({ offset: true }) as z.ZodType<ISODateTime>,
});
export type CreateUploadUrlResponse = z.infer<typeof createUploadUrlResponseSchema>;

export const completeUploadResponseSchema = z.object({
  attachment: attachmentSchema,
  aiJob: aiJobSchema,
});
export type CompleteUploadResponse = z.infer<typeof completeUploadResponseSchema>;

export const attachmentDownloadTargetSchema = z.object({
  attachment: attachmentSchema,
  downloadUrl: z.string().url(),
  downloadExpiresAt: z.string().datetime({ offset: true }) as z.ZodType<ISODateTime>,
});
export type AttachmentDownloadTarget = z.infer<typeof attachmentDownloadTargetSchema>;