import { describe, expect, it, vi } from 'vitest';
import { createReminderHandler } from '../src/handlers/reminder';

const meeting = {
  id: 'meeting-1',
  groupId: 'group-1',
  title: 'Weekly sync',
  organizerId: 'organizer-1',
  attendeeIds: ['member-1'],
  agenda: [],
  startsAt: '2026-08-07T08:00:00.000Z',
  endsAt: '2026-08-07T09:00:00.000Z',
  status: 'SCHEDULED' as const,
  googleSyncStatus: 'NOT_REQUESTED' as const,
  integrationStatus: 'NOT_CONNECTED' as const,
  createdAt: '2026-08-06T00:00:00.000Z',
  createdBy: 'organizer-1',
  updatedAt: '2026-08-06T00:00:00.000Z',
  updatedBy: 'organizer-1',
  version: 1,
};

describe('reminderHandler', () => {
  it('ghi notification trước và không rollback khi SES lỗi', async () => {
    process.env.SES_FROM_EMAIL = 'notifications@example.com';
    const createNotification = vi.fn().mockResolvedValue(undefined);
    const handler = createReminderHandler({
      meetings: { getById: vi.fn().mockResolvedValue(meeting) },
      identities: {
        createNotification,
        getProfiles: vi.fn().mockResolvedValue(
          new Map([
            ['organizer-1', { id: 'organizer-1', email: 'owner@example.com', displayName: 'Owner', timezone: 'UTC', emailNotificationsEnabled: true }],
            ['member-1', { id: 'member-1', email: 'member@example.com', displayName: 'Member', timezone: 'UTC', emailNotificationsEnabled: true }],
          ]),
        ),
      },
      email: { send: vi.fn().mockRejectedValue(new Error('SES_DOWN')) },
    });

    const result = await handler({ reminderId: 'rem-1', meetingId: 'meeting-1' }, {} as never, () => undefined);

    expect(createNotification).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ status: 'DELIVERED', notifications: 2, emailSent: 0, emailFailed: 2 });
  });

  it('bỏ qua meeting đã hủy', async () => {
    const createNotification = vi.fn();
    const handler = createReminderHandler({
      meetings: { getById: vi.fn().mockResolvedValue({ ...meeting, status: 'CANCELLED' }) },
      identities: { createNotification, getProfiles: vi.fn() },
      email: { send: vi.fn() },
    });

    const result = await handler({ reminderId: 'rem-1', meetingId: 'meeting-1' }, {} as never, () => undefined);

    expect(result).toEqual({ status: 'SKIPPED', reason: 'MEETING_CANCELLED' });
    expect(createNotification).not.toHaveBeenCalled();
  });
});
