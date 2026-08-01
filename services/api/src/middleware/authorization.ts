import { GroupRole, type Membership } from '@campusmeet/shared';
import { DynamoDbCollaborationRepository } from '../repositories/collaboration';
import { ForbiddenError } from '../utils/errors';

const groups = new DynamoDbCollaborationRepository();

export async function requireGroupMembership(
  userId: string,
  groupId: string,
  requiredRole?: GroupRole,
): Promise<Membership> {
  const membership = await groups.getMembership(groupId, userId);
  if (!membership) throw new ForbiddenError('Bạn không phải thành viên của nhóm này.');
  if (requiredRole && membership.role !== requiredRole) {
    throw new ForbiddenError('Chỉ Quản trị viên nhóm được thực hiện thao tác này.');
  }
  return membership;
}
