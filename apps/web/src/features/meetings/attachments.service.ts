import type {
  ApiSuccessResponse,
  Attachment,
  AttachmentDownloadTarget,
  CompleteUploadRequest,
  CompleteUploadResponse,
  CreateUploadUrlResponse,
  UploadAttachmentRequest,
} from '@campusmeet/shared';
import { apiClient } from '../../lib/api-client';

export async function getMeetingAttachments(meetingId: string): Promise<Attachment[]> {
  return (
    await apiClient.request<ApiSuccessResponse<Attachment[]>>(
      `/meetings/${meetingId}/attachments`,
    )
  ).data;
}

export async function createAttachmentUploadTarget(
  meetingId: string,
  input: UploadAttachmentRequest,
): Promise<CreateUploadUrlResponse> {
  return (
    await apiClient.request<ApiSuccessResponse<CreateUploadUrlResponse>>(
      `/meetings/${meetingId}/attachments/upload-url`,
      {
        method: 'POST',
        body: JSON.stringify(input),
      },
    )
  ).data;
}

export async function completeAttachmentUpload(
  meetingId: string,
  attachmentId: string,
  input: CompleteUploadRequest,
): Promise<CompleteUploadResponse> {
  return (
    await apiClient.request<ApiSuccessResponse<CompleteUploadResponse>>(
      `/meetings/${meetingId}/attachments/${attachmentId}/complete`,
      {
        method: 'POST',
        body: JSON.stringify(input),
      },
    )
  ).data;
}

export async function getAttachmentDownloadTarget(
  attachmentId: string,
): Promise<AttachmentDownloadTarget> {
  return (
    await apiClient.request<ApiSuccessResponse<AttachmentDownloadTarget>>(
      `/attachments/${attachmentId}/download-url`,
      {
        method: 'POST',
      },
    )
  ).data;
}