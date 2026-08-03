import type {
  ApiSuccessResponse,
  CancelMeetingRequest,
  CreateMeetingRequest,
  MeetingDetailResponse,
  MeetingResponse,
  MeetingTimelineResponse,
  UpdateMeetingRequest,
} from '@campusmeet/shared';
import { apiClient } from '../../lib/api-client';
const query = (values: Record<string, string | number | undefined>) =>
  new URLSearchParams(
    Object.entries(values)
      .filter((entry): entry is [string, string | number] => entry[1] !== undefined)
      .map(([key, value]) => [key, String(value)]),
  ).toString();
export const meetingService = {
  list: (groupId: string, cursor?: string) =>
    apiClient.request<ApiSuccessResponse<MeetingTimelineResponse>>(
      `/meetings?${query({ groupId, cursor, limit: 20 })}`,
    ),
  detail: (meetingId: string) =>
    apiClient.request<ApiSuccessResponse<MeetingDetailResponse>>(
      `/meetings?${query({ meetingId })}`,
    ),
  create: (input: CreateMeetingRequest) =>
    apiClient.request<ApiSuccessResponse<MeetingResponse>>('/meetings', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  update: (meetingId: string, input: UpdateMeetingRequest) =>
    apiClient.request<ApiSuccessResponse<MeetingResponse>>(`/meetings?${query({ meetingId })}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  cancel: (meetingId: string, input: CancelMeetingRequest) =>
    apiClient.request<ApiSuccessResponse<MeetingResponse>>(`/meetings?${query({ meetingId })}`, {
      method: 'DELETE',
      body: JSON.stringify(input),
    }),
};
