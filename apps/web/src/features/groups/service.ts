import type {
  ApiSuccessResponse,
  CreateGroupRequest,
  CreateInvitationResponse,
  Group,
  GroupDetails,
  GroupSummary,
  InvitationDetails,
} from '@campusmeet/shared';
import { apiClient } from '../../lib/api-client';

export async function getGroups(): Promise<GroupSummary[]> {
  return (await apiClient.request<ApiSuccessResponse<GroupSummary[]>>('/groups')).data;
}

export async function createGroup(input: CreateGroupRequest, idempotencyKey: string) {
  return (await apiClient.request<ApiSuccessResponse<GroupSummary>>('/groups', {
    method: 'POST',
    headers: { 'idempotency-key': idempotencyKey },
    body: JSON.stringify(input),
  })).data;
}

export async function getGroup(groupId: string): Promise<GroupDetails> {
  return (await apiClient.request<ApiSuccessResponse<GroupDetails>>(`/groups/${groupId}`)).data;
}

export async function updateGroup(groupId: string, input: CreateGroupRequest): Promise<Group> {
  return (await apiClient.request<ApiSuccessResponse<Group>>(`/groups/${groupId}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  })).data;
}

export async function inviteMember(groupId: string, email: string): Promise<CreateInvitationResponse> {
  return (await apiClient.request<ApiSuccessResponse<CreateInvitationResponse>>(
    `/groups/${groupId}/invitations`,
    { method: 'POST', body: JSON.stringify({ email }) },
  )).data;
}

export async function getGroupInvitations(groupId: string): Promise<InvitationDetails[]> {
  return (await apiClient.request<ApiSuccessResponse<InvitationDetails[]>>(
    `/groups/${groupId}/invitations`,
  )).data;
}

export async function revokeInvitation(groupId: string, invitationId: string): Promise<void> {
  await apiClient.request(`/groups/${groupId}/invitations/${invitationId}/revoke`, { method: 'POST' });
}

export async function removeMember(groupId: string, userId: string): Promise<void> {
  await apiClient.request(`/groups/${groupId}/members/${userId}`, { method: 'DELETE' });
}
