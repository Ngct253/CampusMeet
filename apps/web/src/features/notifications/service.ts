import type { ApiSuccessResponse, Notification } from '@campusmeet/shared';
import { apiClient } from '../../lib/api-client';

export async function getNotifications(): Promise<Notification[]> {
  return (await apiClient.request<ApiSuccessResponse<Notification[]>>('/notifications')).data;
}

export async function markNotificationRead(notificationId: string): Promise<void> {
  await apiClient.request(`/notifications/${notificationId}/read`, { method: 'POST' });
}
