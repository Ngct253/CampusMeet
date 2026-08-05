import {
  GoogleSyncStatus,
  GroupRole,
  IntegrationStatus,
  MeetingStatus,
  type Meeting,
  type Membership,
} from '@campusmeet/shared';
import { describe, expect, it, vi } from 'vitest';
import { DynamoAiAccessAdapter } from '../src/ai/aws-adapters';
import type { MeetingAccessBoundary } from '../src/domain/ports';

const membership: Membership = {
  id: 'group-1:user-1',
  groupId: 'group-1',
  userId: 'user-1',
  role: GroupRole.MEMBER,
  active: true,
  joinedAt: '2026-08-02T00:00:00.000Z',
};

const meeting = (id: string, groupId = 'group-1'): Meeting => ({
  id,
  groupId,
  title: 'Planning',
  organizerId: 'organizer-1',
  attendeeIds: [],
  agenda: [],
  startsAt: '2030-01-01T10:00:00.000Z',
  endsAt: '2030-01-01T11:00:00.000Z',
  status: MeetingStatus.CANCELLED,
  googleSyncStatus: GoogleSyncStatus.NOT_REQUESTED,
  integrationStatus: IntegrationStatus.NOT_CONNECTED,
  createdAt: '2026-08-02T00:00:00.000Z',
  createdBy: 'organizer-1',
  updatedAt: '2026-08-02T00:00:00.000Z',
  updatedBy: 'organizer-1',
  version: 2,
});

const boundary = (items: Meeting[]): MeetingAccessBoundary => ({
  getMeeting: vi.fn(async (id) => items.find((item) => item.id === id) ?? null),
  resolveMeetingGroup: vi.fn(async (id) => items.find((item) => item.id === id)?.groupId ?? null),
  canViewMeeting: vi.fn(),
});

describe('M5 AWS access adapter', () => {
  it('delegates member and admin checks to the shared M1 authorization boundary', async () => {
    const authorizeGroup = vi.fn().mockResolvedValue(membership);
    const meetings = boundary([]);
    const adapter = new DynamoAiAccessAdapter(meetings, authorizeGroup);

    await adapter.requireMember('user-1', 'group-1');
    await adapter.requireGroupAdmin('admin-1', 'group-1');

    expect(authorizeGroup).toHaveBeenNthCalledWith(1, 'user-1', 'group-1');
    expect(authorizeGroup).toHaveBeenNthCalledWith(2, 'admin-1', 'group-1', GroupRole.GROUP_ADMIN);
    expect(meetings.getMeeting).not.toHaveBeenCalled();
  });

  it('does not continue when the M1 authorization boundary rejects access', async () => {
    const authorizeGroup = vi.fn().mockRejectedValue(new Error('FORBIDDEN'));
    const meetings = boundary([]);
    const adapter = new DynamoAiAccessAdapter(meetings, authorizeGroup);

    await expect(adapter.requireMember('outsider-1', 'group-1')).rejects.toThrow('FORBIDDEN');
    expect(meetings.getMeeting).not.toHaveBeenCalled();
  });

  it('resolves trusted group and cancelled lifecycle through the M2 boundary', async () => {
    const meetings = boundary([meeting('meeting-1')]);
    const adapter = new DynamoAiAccessAdapter(meetings, vi.fn());

    await expect(adapter.getMeetingGroupId('meeting-1')).resolves.toBe('group-1');
    await expect(adapter.requireMeetingsInGroup(['meeting-1'], 'group-1')).resolves.toBeUndefined();
    expect(meetings.getMeeting).toHaveBeenCalledWith('meeting-1');
  });

  it('rejects selected meetings from another group through the M2 boundary', async () => {
    const meetings = boundary([meeting('meeting-a'), meeting('meeting-b', 'group-2')]);
    const adapter = new DynamoAiAccessAdapter(meetings, vi.fn());

    await expect(
      adapter.requireMeetingsInGroup(['meeting-a', 'meeting-b'], 'group-1'),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
