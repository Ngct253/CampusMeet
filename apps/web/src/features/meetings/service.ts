import type {
  ApiSuccessResponse,
  CancelMeetingRequest,
  CreateMeetingRequest,
  Meeting,
  MeetingMinutes,
  MeetingTimelineResponse,
  GoogleMeetingSyncResponse,
  UpdateMeetingMinutesRequest,
  UpdateMeetingRequest,
} from '@campusmeet/shared';
import { apiClient } from '../../lib/api-client';

export async function getMeetings(
  groupId: string,
  options: { limit?: number; cursor?: string } = {},
): Promise<MeetingTimelineResponse> {
  const query = new URLSearchParams();
  if (options.limit !== undefined) query.set('limit', String(options.limit));
  if (options.cursor) query.set('cursor', options.cursor);
  const suffix = query.size ? `?${query.toString()}` : '';
  return (
    await apiClient.request<ApiSuccessResponse<MeetingTimelineResponse>>(
      `/groups/${groupId}/meetings${suffix}`,
    )
  ).data;
}

export async function getAllMeetings(groupId: string): Promise<Meeting[]> {
  const items: Meeting[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await getMeetings(groupId, { limit: 100, ...(cursor ? { cursor } : {}) });
    items.push(...page.items);
    cursor = page.nextCursor;
    if (cursor && seen.has(cursor)) throw new Error('Meeting pagination cursor repeated.');
    if (cursor) seen.add(cursor);
  } while (cursor);
  return items;
}
export async function getMyMeetings(): Promise<Meeting[]> {
  return (await apiClient.request<ApiSuccessResponse<Meeting[]>>('/meetings')).data;
}

export async function getMeeting(meetingId: string): Promise<Meeting> {
  return (await apiClient.request<ApiSuccessResponse<Meeting>>(`/meetings/${meetingId}`)).data;
}

export async function getMeetingMinutes(meetingId: string): Promise<MeetingMinutes> {
  return (
    await apiClient.request<ApiSuccessResponse<MeetingMinutes>>(
      `/meetings/${encodeURIComponent(meetingId)}/minutes`,
    )
  ).data;
}

export async function updateMeetingMinutes(
  meetingId: string,
  input: UpdateMeetingMinutesRequest,
): Promise<MeetingMinutes> {
  return (
    await apiClient.request<ApiSuccessResponse<MeetingMinutes>>(
      `/meetings/${encodeURIComponent(meetingId)}/minutes`,
      { method: 'PUT', body: JSON.stringify(input) },
    )
  ).data;
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

export async function retryGoogleMeetingSync(
  meetingId: string,
): Promise<GoogleMeetingSyncResponse> {
  return (
    await apiClient.request<ApiSuccessResponse<GoogleMeetingSyncResponse>>(
      `/meetings/${encodeURIComponent(meetingId)}/google-sync/retry`,
      { method: 'POST', body: '{}' },
    )
  ).data;
}
