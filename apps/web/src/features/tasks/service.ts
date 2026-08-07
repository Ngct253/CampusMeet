import type {
  ApiSuccessResponse,
  CreateTaskRequest,
  Task,
  UpdateTaskStatusRequest,
} from '@campusmeet/shared';
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

export async function updateTaskStatus(
  taskId: string,
  input: UpdateTaskStatusRequest,
): Promise<Task> {
  return (
    await apiClient.request<ApiSuccessResponse<Task>>(
      `/tasks/${encodeURIComponent(taskId)}/status`,
      {
        method: 'PATCH',
        body: JSON.stringify(input),
      },
    )
  ).data;
}
