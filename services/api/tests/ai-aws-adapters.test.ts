import { GroupRole, type Membership } from '@campusmeet/shared';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { describe, expect, it, vi } from 'vitest';
import { DynamoAiAccessAdapter } from '../src/ai/aws-adapters';

const membership: Membership = {
  id: 'group-1:user-1',
  groupId: 'group-1',
  userId: 'user-1',
  role: GroupRole.MEMBER,
  active: true,
  joinedAt: '2026-08-02T00:00:00.000Z',
};

describe('M5 AWS access adapter', () => {
  it('delegates member and admin checks to the shared M1 authorization boundary', async () => {
    const authorizeGroup = vi.fn().mockResolvedValue(membership);
    const database = { send: vi.fn() } as unknown as DynamoDBDocumentClient;
    const adapter = new DynamoAiAccessAdapter(database, 'meeting-data', authorizeGroup);

    await adapter.requireMember('user-1', 'group-1');
    await adapter.requireGroupAdmin('admin-1', 'group-1');

    expect(authorizeGroup).toHaveBeenNthCalledWith(1, 'user-1', 'group-1');
    expect(authorizeGroup).toHaveBeenNthCalledWith(2, 'admin-1', 'group-1', GroupRole.GROUP_ADMIN);
    expect(database.send).not.toHaveBeenCalled();
  });

  it('does not continue when the M1 authorization boundary rejects access', async () => {
    const authorizeGroup = vi.fn().mockRejectedValue(new Error('FORBIDDEN'));
    const database = { send: vi.fn() } as unknown as DynamoDBDocumentClient;
    const adapter = new DynamoAiAccessAdapter(database, 'meeting-data', authorizeGroup);

    await expect(adapter.requireMember('outsider-1', 'group-1')).rejects.toThrow('FORBIDDEN');
    expect(database.send).not.toHaveBeenCalled();
  });
});
