import { beforeEach, describe, expect, it, vi } from 'vitest';

const send = vi.hoisted(() => vi.fn());
vi.mock('../src/repositories/client', () => ({
  documentClient: { send },
  tableName: (name: string) => name,
  stringValue: (item: Record<string, unknown>, key: string) =>
    typeof item[key] === 'string' ? item[key] : undefined,
}));

import { DynamoDbIdentityRepository } from '../src/repositories/identity';

describe('M1 notification ownership', () => {
  beforeEach(() => send.mockReset());

  it('lookup và update notification luôn khóa theo user đang đăng nhập', async () => {
    send
      .mockResolvedValueOnce({
        Items: [{ PK: 'USER#user-1', SK: 'NOTIFICATION#now#notification-1' }],
      })
      .mockResolvedValueOnce({});
    await new DynamoDbIdentityRepository().markNotificationRead('user-1', 'notification-1');

    const lookup = send.mock.calls[0]?.[0] as {
      input: { ExpressionAttributeValues: Record<string, string> };
    };
    const update = send.mock.calls[1]?.[0] as {
      input: { ExpressionAttributeValues: Record<string, unknown> };
    };
    expect(lookup.input.ExpressionAttributeValues[':user']).toBe('USER#user-1');
    expect(update.input.ExpressionAttributeValues[':pk']).toBe('USER#user-1');
  });

  it('không tìm thấy notification của user khác thì không update', async () => {
    send.mockResolvedValueOnce({ Items: [] });
    await expect(
      new DynamoDbIdentityRepository().markNotificationRead('user-1', 'notification-other'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('mỗi notification lời mời mở đúng invitation id kể cả dữ liệu cũ', async () => {
    send.mockResolvedValueOnce({
      Items: [
        {
          id: 'invitation-invite-old',
          type: 'INVITATION',
          title: 'Bạn được mời tham gia nhóm A',
          actionUrl: '/app/invitations',
          read: true,
          createdAt: '2026-08-01T00:00:00.000Z',
        },
      ],
    });

    const [notification] = await new DynamoDbIdentityRepository().listNotifications('user-1');

    expect(notification?.actionUrl).toBe('/app/invitations?invitationId=invite-old');
  });
});
