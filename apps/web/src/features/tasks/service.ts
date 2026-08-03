import type { ApiSuccessResponse, Task } from '@campusmeet/shared';
import { apiClient } from '../../lib/api-client';

export async function getTasks(): Promise<Task[]> {
  return (await apiClient.request<ApiSuccessResponse<Task[]>>('/tasks')).data;
}
