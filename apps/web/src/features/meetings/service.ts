import type { ApiSuccessResponse, Meeting } from '@campusmeet/shared';
import { apiClient } from '../../lib/api-client';

export async function getMeetings(): Promise<Meeting[]> {
  return (await apiClient.request<ApiSuccessResponse<Meeting[]>>('/meetings')).data;
}
