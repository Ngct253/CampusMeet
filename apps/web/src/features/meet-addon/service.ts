import type { ApiSuccessResponse, Meeting } from '@campusmeet/shared';
import { apiClient } from '../../lib/api-client';

export async function resolveMeetContext(meetingId: string): Promise<Meeting> {
  return (
    await apiClient.request<ApiSuccessResponse<Meeting>>(
      `/integrations/google/meet-context?meetingId=${encodeURIComponent(meetingId)}`,
    )
  ).data;
}
