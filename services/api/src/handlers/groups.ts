import type { CreateGroupRequest, CreateInvitationRequest } from '@campusmeet/shared';
import { createSkeletonHandler } from './skeleton';
export const groupsHandler = createSkeletonHandler<CreateGroupRequest>('Groups');
export const membershipsHandler = createSkeletonHandler<CreateInvitationRequest>(
  'Memberships / Invitations',
);
