import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { GroupRole, groupInputSchema, invitationInputSchema } from '@campusmeet/shared';
import { authenticate } from '../middleware/authentication';
import { requireGroupMembership } from '../middleware/authorization';
import { handleError } from '../middleware/error-handler';
import { DynamoDbCollaborationRepository } from '../repositories/collaboration';
import { DynamoDbIdentityRepository } from '../repositories/identity';
import { ApiError, ConflictError } from '../utils/errors';
import { getPathParameter, getRequestId, parseBody, requireIdempotencyKey } from '../utils/request';
import { ok } from '../utils/response';

const groups = new DynamoDbCollaborationRepository();
const identities = new DynamoDbIdentityRepository();

const handler = (
  action: (event: Parameters<APIGatewayProxyHandlerV2>[0], requestId: string) => Promise<unknown>,
): APIGatewayProxyHandlerV2 => async (event) => {
  const requestId = getRequestId(event);
  try {
    return ok(await action(event, requestId), requestId);
  } catch (error) {
    return handleError(error, requestId);
  }
};

export const groupsHandler = handler(async (event) => {
  const auth = authenticate(event);
  if (event.requestContext.http.method === 'GET') return groups.listForUser(auth.userId);
  if (event.requestContext.http.method === 'POST') {
    await identities.ensureProfile(auth);
    return groups.createGroup(auth.userId, parseBody(event, groupInputSchema), requireIdempotencyKey(event));
  }
  throw new ApiError('METHOD_NOT_ALLOWED', 'Phương thức chưa được hỗ trợ.', 405);
});

export const groupDetailHandler = handler(async (event) => {
  const auth = authenticate(event);
  const groupId = getPathParameter(event, 'groupId');
  if (event.requestContext.http.method === 'GET') return groups.getDetails(groupId, auth.userId);
  if (event.requestContext.http.method === 'PATCH') {
    await requireGroupMembership(auth.userId, groupId, GroupRole.GROUP_ADMIN);
    const input = parseBody(event, groupInputSchema);
    return groups.updateGroup(groupId, auth.userId, input.name, input.description);
  }
  throw new ApiError('METHOD_NOT_ALLOWED', 'Phương thức chưa được hỗ trợ.', 405);
});

export const groupInvitationsHandler = handler(async (event) => {
  const auth = authenticate(event);
  const groupId = getPathParameter(event, 'groupId');
  await requireGroupMembership(auth.userId, groupId, GroupRole.GROUP_ADMIN);
  if (event.requestContext.http.method === 'GET') return groups.listInvitations(groupId);
  if (event.requestContext.http.method !== 'POST') {
    throw new ApiError('METHOD_NOT_ALLOWED', 'Phương thức chưa được hỗ trợ.', 405);
  }
  const email = parseBody(event, invitationInputSchema).email;
  const invitedUserId = await identities.findUserIdByEmail(email);
  if (invitedUserId && await groups.getMembership(groupId, invitedUserId)) {
    throw new ConflictError('Người dùng này đã là thành viên của nhóm.');
  }
  return groups.createInvitation(groupId, auth.userId, email, invitedUserId);
});

export const revokeGroupInvitationHandler = handler(async (event) => {
  if (event.requestContext.http.method !== 'POST') {
    throw new ApiError('METHOD_NOT_ALLOWED', 'Phương thức chưa được hỗ trợ.', 405);
  }
  const auth = authenticate(event);
  const groupId = getPathParameter(event, 'groupId');
  await requireGroupMembership(auth.userId, groupId, GroupRole.GROUP_ADMIN);
  await groups.revokeInvitation(groupId, getPathParameter(event, 'invitationId'), auth.userId);
  return { revoked: true };
});

export const groupMemberHandler = handler(async (event) => {
  if (event.requestContext.http.method !== 'DELETE') {
    throw new ApiError('METHOD_NOT_ALLOWED', 'Phương thức chưa được hỗ trợ.', 405);
  }
  const auth = authenticate(event);
  const groupId = getPathParameter(event, 'groupId');
  await requireGroupMembership(auth.userId, groupId, GroupRole.GROUP_ADMIN);
  await groups.removeMember(groupId, auth.userId, getPathParameter(event, 'userId'));
  return { removed: true };
});
