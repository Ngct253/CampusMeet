import type {
  ApiSuccessResponse,
  CancelMeetingRequest,
  CreateMeetingRequest,
  Meeting,
  UpdateMeetingRequest,
} from '@campusmeet/shared';
import { apiClient } from '../../lib/api-client';

export async function getMeetings(groupId: string): Promise<Meeting[]> {
  return (await apiClient.request<ApiSuccessResponse<Meeting[]>>(`/groups/${groupId}/meetings`))
    .data;
}

export async function getMyMeetings(): Promise<Meeting[]> {
  return (await apiClient.request<ApiSuccessResponse<Meeting[]>>('/meetings')).data;
}

export async function getMeeting(meetingId: string): Promise<Meeting> {
  return (await apiClient.request<ApiSuccessResponse<Meeting>>(`/meetings/${meetingId}`)).data;
}

export async function createMeeting(
  groupId: string,
  input: CreateMeetingRequest,
  idempotencyKey: string,
): Promise<Meeting> {
  return (
    await apiClient.request<ApiSuccessResponse<Meeting>>(`/groups/${groupId}/meetings`, {
      method: 'POST',
      headers: { 'idempotency-key': idempotencyKey },
      body: JSON.stringify(input),
    })
  ).data;
}

export async function updateMeeting(
  meetingId: string,
  input: UpdateMeetingRequest,
): Promise<Meeting> {
  return (
    await apiClient.request<ApiSuccessResponse<Meeting>>(`/meetings/${meetingId}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    })
  ).data;
}

export async function cancelMeeting(
  meetingId: string,
  input: CancelMeetingRequest = {},
): Promise<Meeting> {
  return (
    await apiClient.request<ApiSuccessResponse<Meeting>>(`/meetings/${meetingId}/cancel`, {
      method: 'POST',
      body: JSON.stringify(input),
    })
  ).data;
}
