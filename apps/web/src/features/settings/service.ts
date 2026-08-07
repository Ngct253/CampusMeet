import type { ApiSuccessResponse, UpdateProfileRequest, UserProfile } from '@campusmeet/shared';
import { apiClient } from '../../lib/api-client';

export async function getProfile(): Promise<UserProfile> {
  return (await apiClient.request<ApiSuccessResponse<UserProfile>>('/me')).data;
}

export async function updateProfile(input: UpdateProfileRequest): Promise<UserProfile> {
  return (await apiClient.request<ApiSuccessResponse<UserProfile>>('/me', {
    method: 'PATCH',
    body: JSON.stringify(input),
  })).data;
}

export async function connectGoogleCalendar(): Promise<{ authorizationUrl: string; expiresAt: string }> {
  return (await apiClient.request<ApiSuccessResponse<{ authorizationUrl: string; expiresAt: string }>>(
    '/integrations/google/connect',
    { method: 'POST' },
  )).data;
}
