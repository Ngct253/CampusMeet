import type { ApiSuccessResponse, InvitationDetails } from '@campusmeet/shared';
import { apiClient } from '../../lib/api-client';

export async function getInvitation(token: string): Promise<InvitationDetails> {
  return (
    await apiClient.request<ApiSuccessResponse<InvitationDetails>>(
      `/invitations/${encodeURIComponent(token)}`,
    )
  ).data;
}

export async function respondInvitation(token: string, response: 'accept' | 'decline') {
  return (
    await apiClient.request<ApiSuccessResponse<InvitationDetails>>(
      `/invitations/${encodeURIComponent(token)}/${response}`,
      { method: 'POST' },
    )
  ).data;
}

export async function getMyInvitations(): Promise<InvitationDetails[]> {
  return (await apiClient.request<ApiSuccessResponse<InvitationDetails[]>>('/invitations')).data;
}

export async function respondDirectInvitation(
  invitationId: string,
  response: 'accept' | 'decline',
) {
  return (
    await apiClient.request<ApiSuccessResponse<InvitationDetails>>(
      `/invitations/by-id/${encodeURIComponent(invitationId)}/${response}`,
      { method: 'POST' },
    )
  ).data;
}
