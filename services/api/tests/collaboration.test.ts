import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GroupRole, InvitationStatus, groupInputSchema } from '@campusmeet/shared';

const send = vi.hoisted(() => vi.fn());
const markNotificationRead = vi.hoisted(() => vi.fn());
vi.mock('../src/repositories/client', () => ({
  documentClient: { send },
  tableName: (name: string) => name,
  stringValue: (item: Record<string, unknown>, key: string) =>
    typeof item[key] === 'string' ? item[key] : undefined,
}));
vi.mock('../src/repositories/identity', () => ({
  DynamoDbIdentityRepository: class {
    getProfiles = vi.fn().mockResolvedValue(new Map());
    markNotificationRead = markNotificationRead;
  },
}));

import { DynamoDbCollaborationRepository } from '../src/repositories/collaboration';

describe('M1 collaboration repository', () => {
  beforeEach(() => {
    send.mockReset();
    markNotificationRead.mockReset().mockResolvedValue(undefined);
  });

  it('từ chối tên nhóm rỗng trước khi gọi DynamoDB', () => {
    expect(groupInputSchema.safeParse({ name: ' ' }).success).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it('tạo group và membership Quản trị viên trong một transaction', async () => {
    send.mockResolvedValueOnce({});
    const result = await new DynamoDbCollaborationRepository().createGroup(
      'user-1',
      { name: 'Đồ án tốt nghiệp' },
      'request-1',
    );
    const command = send.mock.calls[0]?.[0] as { input: { TransactItems: unknown[] } };
    expect(result.role).toBe(GroupRole.GROUP_ADMIN);
    expect(command.input.TransactItems).toHaveLength(3);
    expect(JSON.stringify(command.input.TransactItems)).toContain('GROUP_ADMIN');
  });

  it('chỉ lưu hash của token lời mời trong collaboration table', async () => {
    send
      .mockResolvedValueOnce({
        Item: {
          PK: 'GROUP#group-1',
          SK: 'META',
          id: 'group-1',
          name: 'Nhóm A',
          createdBy: 'user-1',
          createdAt: '2026-08-01T00:00:00.000Z',
        },
      })
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({});
    const result = await new DynamoDbCollaborationRepository().createInvitation(
      'group-1',
      'user-1',
      'LAN@example.edu',
    );
    const command = send.mock.calls[2]?.[0] as { input: { TransactItems: unknown[] } };
    const stored = JSON.stringify(command.input.TransactItems);
    expect(result.invitation.email).toBe('lan@example.edu');
    expect(stored).toContain('tokenHash');
    expect(stored).not.toContain(result.inviteToken);
  });

  it('tạo notification cho tài khoản đã đăng ký trong cùng transaction với lời mời', async () => {
    send
      .mockResolvedValueOnce({
        Item: {
          PK: 'GROUP#group-1',
          SK: 'META',
          id: 'group-1',
          name: 'Nhóm A',
          createdBy: 'user-1',
          createdAt: '2026-08-01T00:00:00.000Z',
        },
      })
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({});
    const result = await new DynamoDbCollaborationRepository().createInvitation(
      'group-1',
      'user-1',
      'lan@example.edu',
      'user-2',
    );
    const command = send.mock.calls[2]?.[0] as { input: { TransactItems: unknown[] } };
    const stored = JSON.stringify(command.input.TransactItems);
    expect(command.input.TransactItems).toHaveLength(3);
    expect(stored).toContain('USER#user-2');
    expect(stored).toContain('INVITATION');
    expect(stored).not.toContain(result.inviteToken);
  });

  it('retry tạo group trả lại group cũ thay vì tạo bản ghi trùng', async () => {
    send
      .mockRejectedValueOnce(new Error('transaction retry'))
      .mockResolvedValueOnce({
        Item: {
          PK: 'GROUP#existing',
          SK: 'META',
          id: 'existing',
          name: 'Nhóm cũ',
          createdBy: 'user-1',
          createdAt: '2026-08-01T00:00:00.000Z',
        },
      })
      .mockResolvedValueOnce({
        Item: {
          id: 'existing:user-1',
          groupId: 'existing',
          userId: 'user-1',
          role: GroupRole.GROUP_ADMIN,
          active: true,
          joinedAt: '2026-08-01T00:00:00.000Z',
        },
      });
    const repository = new DynamoDbCollaborationRepository();
    const groupId = await repository
      .createGroup('user-1', { name: 'Nhóm cũ' }, 'retry-key')
      .then((group) => group.id);
    expect(groupId).toBe('existing');
    expect(send).toHaveBeenCalledTimes(3);
  });

  it('chặn xóa Quản trị viên khỏi nhóm', async () => {
    const repository = new DynamoDbCollaborationRepository();
    vi.spyOn(repository, 'getMembership').mockResolvedValue({
      id: 'group-1:user-1',
      groupId: 'group-1',
      userId: 'user-1',
      role: GroupRole.GROUP_ADMIN,
      active: true,
      joinedAt: '2026-08-01T00:00:00.000Z',
    });
    await expect(repository.removeMember('group-1', 'user-1', 'user-1')).rejects.toThrow(
      'Không thể xóa Quản trị viên khỏi nhóm.',
    );
    expect(send).not.toHaveBeenCalled();
  });

  it('từ chối lời mời đã hết hạn trước khi ghi membership', async () => {
    const repository = new DynamoDbCollaborationRepository();
    vi.spyOn(repository, 'getInvitation').mockResolvedValue({
      id: 'invite-1',
      groupId: 'group-1',
      groupName: 'Nhóm A',
      email: 'lan@example.edu',
      status: InvitationStatus.PENDING,
      createdAt: '2026-07-01T00:00:00.000Z',
      expiresAt: '2026-07-02T00:00:00.000Z',
    });
    await expect(
      repository.respondInvitation('token', 'user-1', 'lan@example.edu', true),
    ).rejects.toThrow('Lời mời đã hết hạn.');
    expect(send).not.toHaveBeenCalled();
  });

  it('chấp nhận lời mời trực tiếp bằng id của đúng email đăng nhập', async () => {
    const repository = new DynamoDbCollaborationRepository();
    vi.spyOn(repository, 'listInvitationsForEmail').mockResolvedValue([
      {
        id: 'invite-1',
        groupId: 'group-1',
        groupName: 'Nhóm A',
        email: 'lan@example.edu',
        status: InvitationStatus.PENDING,
        createdAt: '2026-08-01T00:00:00.000Z',
        expiresAt: '2099-08-08T00:00:00.000Z',
      },
    ]);
    vi.spyOn(repository, 'getMembership').mockResolvedValue(undefined);
    send.mockResolvedValueOnce({});

    const result = await repository.respondInvitationById(
      'invite-1',
      'user-2',
      'lan@example.edu',
      true,
    );

    expect(result.status).toBe(InvitationStatus.ACCEPTED);
    expect(JSON.stringify(send.mock.calls[0]?.[0])).toContain('MEMBER#user-2');
    expect(markNotificationRead).toHaveBeenCalledWith('user-2', 'invitation-invite-1');
  });

  it('thu hồi lời mời đang chờ và xóa các index tra cứu', async () => {
    send.mockResolvedValueOnce({});
    await new DynamoDbCollaborationRepository().revokeInvitation('group-1', 'invite-1', 'user-1');
    const command = send.mock.calls[0]?.[0] as {
      input: { TransactItems: Array<{ Update?: { UpdateExpression: string } }> };
    };
    expect(command.input.TransactItems).toHaveLength(2);
    expect(command.input.TransactItems[0]?.Update?.UpdateExpression).toContain('GSI2PK');
    expect(JSON.stringify(command.input.TransactItems)).toContain('REVOKED');
  });
});
