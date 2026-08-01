import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GroupRole } from '@campusmeet/shared';

const getMembership = vi.hoisted(() => vi.fn());
vi.mock('../src/repositories/collaboration', () => ({
  DynamoDbCollaborationRepository: class { getMembership = getMembership; },
}));

import { requireGroupMembership } from '../src/middleware/authorization';

describe('M1 authorization boundary', () => {
  beforeEach(() => getMembership.mockReset());

  it('từ chối user ngoài nhóm', async () => {
    getMembership.mockResolvedValue(undefined);
    await expect(requireGroupMembership('outsider', 'group-1')).rejects.toMatchObject({
      code: 'FORBIDDEN',
      statusCode: 403,
    });
  });

  it('không cho MEMBER thực hiện thao tác của Group Admin', async () => {
    getMembership.mockResolvedValue({ role: GroupRole.MEMBER, active: true });
    await expect(requireGroupMembership('user-1', 'group-1', GroupRole.GROUP_ADMIN)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });
});
