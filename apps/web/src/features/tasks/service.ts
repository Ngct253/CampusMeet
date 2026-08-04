import type { ApiSuccessResponse, CreateTaskRequest, Task } from '@campusmeet/shared';
import { apiClient } from '../../lib/api-client';

export async function getTasks(): Promise<Task[]> {
  return (await apiClient.request<ApiSuccessResponse<Task[]>>('/tasks')).data;
}

export async function createTask(
  input: CreateTaskRequest,
  idempotencyKey: string,
): Promise<Task> {
  return (
    await apiClient.request<ApiSuccessResponse<Task>>('/tasks', {
      method: 'POST',
      headers: { 'idempotency-key': idempotencyKey },
      body: JSON.stringify(input),
    })
  ).data;
}
