import type { ApiSuccessResponse, DashboardResponse } from '@campusmeet/shared';
import { apiClient } from '../../lib/api-client';

export async function getDashboard(): Promise<DashboardResponse> {
  return (await apiClient.request<ApiSuccessResponse<DashboardResponse>>('/dashboard')).data;
}
