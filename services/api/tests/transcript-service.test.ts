import { describe, expect, it, vi } from 'vitest';
import { GroupRole, type Meeting, type Transcript } from '@campusmeet/shared';
import type { TranscriptRepository } from '../src/domain/transcript-ports';
import { TranscriptService } from '../src/services/transcript-service';

const meeting = { id: 'meeting-1', groupId: 'group-1', organizerId: 'organizer-1' } as Meeting;
const transcript: Transcript = {
  transcriptId: 'transcript-1',
  meetingId: 'meeting-1',
  groupId: 'group-1',
  status: 'READY',
  version: 1,
  createdAt: '2026-08-08T00:00:00.000Z',
  updatedAt: '2026-08-08T00:00:00.000Z',
};
const setup = (role = GroupRole.MEMBER, actor = 'member-1') => {
  const repository = {
    getCanonical: vi.fn().mockResolvedValue({ transcript: null, segments: [] }),
    getById: vi.fn().mockResolvedValue(transcript),
    updateSegment: vi
      .fn()
      .mockResolvedValue({ transcript: { ...transcript, version: 2 }, segment: {} }),
  } as unknown as TranscriptRepository;
  const meetings = { getById: vi.fn().mockResolvedValue(meeting) };
  const memberships = {
    getMembership: vi
      .fn()
      .mockResolvedValue({ groupId: 'group-1', userId: actor, role, active: true }),
  };
  return {
    service: new TranscriptService(repository, meetings as never, memberships as never),
    repository,
    meetings,
    memberships,
  };
};
describe('TranscriptService', () => {
  it('authorizes active members to read using the persisted Meeting group', async () => {
    const { service, repository, memberships } = setup();
    await expect(service.get('member-1', 'meeting-1', 25)).resolves.toEqual({
      transcript: null,
      segments: [],
    });
    expect(memberships.getMembership).toHaveBeenCalledWith('group-1', 'member-1');
    expect(repository.getCanonical).toHaveBeenCalledWith('meeting-1', 'group-1', 25, undefined);
  });
  it.each([
    undefined,
    { groupId: 'group-1', userId: 'member-1', role: GroupRole.MEMBER, active: false },
  ])('rejects missing and inactive membership reads', async (membership) => {
    const context = setup();
    context.memberships.getMembership.mockResolvedValue(membership);
    await expect(context.service.get('member-1', 'meeting-1')).rejects.toMatchObject({
      statusCode: 403,
    });
  });
  it('allows an active organizer to edit with the exact expected version', async () => {
    const { service, repository } = setup(GroupRole.MEMBER, 'organizer-1');
    await service.edit('organizer-1', 'transcript-1', 'segment-1', {
      expectedVersion: 1,
      text: 'Edited',
    });
    expect(repository.updateSegment).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: 'organizer-1', segmentId: 'segment-1' }),
    );
  });
  it('allows GROUP_ADMIN and rejects a normal member', async () => {
    await expect(
      setup(GroupRole.GROUP_ADMIN, 'admin-1').service.edit('admin-1', 'transcript-1', 'segment-1', {
        expectedVersion: 1,
        text: 'Edited',
      }),
    ).resolves.toBeDefined();
    await expect(
      setup().service.edit('member-1', 'transcript-1', 'segment-1', {
        expectedVersion: 1,
        text: 'Edited',
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
  it.each([
    [GroupRole.MEMBER, 'organizer-1'],
    [GroupRole.GROUP_ADMIN, 'admin-1'],
  ] as const)('rejects inactive privileged membership', async (role, actor) => {
    const context = setup(role, actor);
    context.memberships.getMembership.mockResolvedValue({
      groupId: 'group-1',
      userId: actor,
      role,
      active: false,
    });
    await expect(
      context.service.edit(actor, 'transcript-1', 'segment-1', {
        expectedVersion: 1,
        text: 'Edited',
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
  it('rejects stale versions and non-editable lifecycle', async () => {
    await expect(
      setup(GroupRole.GROUP_ADMIN, 'admin-1').service.edit('admin-1', 'transcript-1', 'segment-1', {
        expectedVersion: 2,
        text: 'Edited',
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
    const context = setup(GroupRole.GROUP_ADMIN, 'admin-1');
    context.repository.getById = vi.fn().mockResolvedValue({ ...transcript, status: 'LIVE' });
    await expect(
      context.service.edit('admin-1', 'transcript-1', 'segment-1', {
        expectedVersion: 1,
        text: 'Edited',
      }),
    ).rejects.toMatchObject({ statusCode: 422 });
  });
  it.each(['LIVE', 'FINALIZING', 'FAILED'] as const)(
    'rejects %s lifecycle with 422',
    async (status) => {
      const context = setup(GroupRole.GROUP_ADMIN, 'admin-1');
      context.repository.getById = vi.fn().mockResolvedValue({ ...transcript, status });
      await expect(
        context.service.edit('admin-1', 'transcript-1', 'segment-1', {
          expectedVersion: 1,
          text: 'Edited',
        }),
      ).rejects.toMatchObject({ statusCode: 422 });
    },
  );
  it.each(['READY', 'APPROVED'] as const)(
    'allows %s lifecycle for an active admin',
    async (status) => {
      const context = setup(GroupRole.GROUP_ADMIN, 'admin-1');
      context.repository.getById = vi.fn().mockResolvedValue(
        status === 'APPROVED'
          ? {
              ...transcript,
              status,
              approvedVersion: 1,
              approvedBy: 'user-x',
              approvedAt: '2026-08-07T00:00:00.000Z',
            }
          : { ...transcript, status },
      );
      await expect(
        context.service.edit('admin-1', 'transcript-1', 'segment-1', {
          expectedVersion: 1,
          text: 'Edited',
        }),
      ).resolves.toBeDefined();
    },
  );
});
