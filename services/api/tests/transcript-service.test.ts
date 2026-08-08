import { describe, expect, it, vi } from 'vitest';
import {
  GroupRole,
  type AIJob,
  type Meeting,
  type Transcript,
  type TranscriptSegment,
} from '@campusmeet/shared';
import type { TranscriptRepository } from '../src/domain/transcript-ports';
import { serializeTranscriptSegments, TranscriptService } from '../src/services/transcript-service';

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
const segment: TranscriptSegment = {
  segmentId: 'segment-1',
  transcriptId: 'transcript-1',
  sequence: 1,
  startMs: 0,
  endMs: 100,
  text: 'Xin chào',
  confidence: 0.9,
  languageCode: 'vi-VN',
  speakerLabel: 'Speaker 1',
  isFinal: true,
  version: 1,
};
const queuedJob: AIJob = {
  aiJobId: 'aij-1',
  groupId: 'group-1',
  meetingId: 'meeting-1',
  type: 'INGEST_SOURCE',
  status: 'QUEUED',
  attempt: 0,
  requestId: 'request-1',
  createdAt: '2026-08-08T00:00:00.000Z',
  updatedAt: '2026-08-08T00:00:00.000Z',
};
const setup = (role = GroupRole.MEMBER, actor = 'member-1') => {
  const handoff = {
    transcriptId: 'transcript-1',
    meetingId: 'meeting-1',
    groupId: 'group-1',
    approvedVersion: 1,
    artifactObjectKey: 'uploads/group-1/meeting-1/transcripts/transcript-1/v1/content.txt',
    artifactChecksum: 'checksum',
    aiJobId: 'aij-1',
    aiOperation: 'INGEST_SOURCE' as const,
    aiJobType: 'INGEST_SOURCE' as const,
    createdAt: '2026-08-08T01:00:00.000Z',
    updatedAt: '2026-08-08T01:00:00.000Z',
  };
  const approvedTranscript: Transcript = {
    ...transcript,
    status: 'APPROVED',
    approvedVersion: 1,
    approvedBy: actor,
    approvedAt: '2026-08-08T01:00:00.000Z',
    updatedAt: '2026-08-08T01:00:00.000Z',
  };
  const repository = {
    getCanonical: vi.fn().mockResolvedValue({ transcript: null, segments: [] }),
    getById: vi.fn().mockResolvedValue(transcript),
    updateSegment: vi
      .fn()
      .mockResolvedValue({ transcript: { ...transcript, version: 2 }, segment: {} }),
    getAllSegments: vi.fn().mockResolvedValue([segment]),
    getApprovalHandoff: vi.fn().mockResolvedValue(handoff),
    getApprovalIntent: vi.fn().mockResolvedValue(null),
    bindApprovalIntent: vi.fn().mockResolvedValue(undefined),
    approve: vi.fn().mockResolvedValue({
      transcript: approvedTranscript,
      handoff,
      created: true,
    }),
  } as unknown as TranscriptRepository;
  const meetings = { getById: vi.fn().mockResolvedValue(meeting) };
  const memberships = {
    getMembership: vi
      .fn()
      .mockResolvedValue({ groupId: 'group-1', userId: actor, role, active: true }),
  };
  const objects = {
    writeImmutable: vi.fn().mockResolvedValue({
      objectKey: handoff.artifactObjectKey,
      sha256: 'checksum',
      sizeBytes: 20,
      replayed: false,
    }),
  };
  const jobs = {
    prepareJob: vi.fn().mockReturnValue({
      aiJobId: 'aij-1',
      job: queuedJob,
      payload: {},
      persistenceContribution: { Put: { TableName: 'ai-work', Item: {} } },
    }),
    enqueue: vi.fn(),
    ensureStarted: vi.fn().mockResolvedValue(queuedJob),
  };
  return {
    service: new TranscriptService(
      repository,
      meetings as never,
      memberships as never,
      {
        objects,
        jobs,
      } as never,
    ),
    repository,
    meetings,
    memberships,
    objects,
    jobs,
    handoff,
    approvedTranscript,
  };
};
describe('TranscriptService', () => {
  it('serializes every segment by sequence then binary id with normalized LF and trailing newline', () => {
    const content = serializeTranscriptSegments([
      { ...segment, segmentId: 'b', sequence: 2, text: 'Second\r\nline' },
      { ...segment, segmentId: 'a', sequence: 2, text: 'Tie' },
      { ...segment, segmentId: 'z', sequence: 1, text: 'First' },
    ]);
    expect(Buffer.from(content).toString('utf8')).toBe(
      'Speaker 1: First\nSpeaker 1: Tie\nSpeaker 1: Second\nline\n',
    );
  });
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

  describe('approval', () => {
    it.each([
      [GroupRole.MEMBER, 'organizer-1'],
      [GroupRole.GROUP_ADMIN, 'admin-1'],
    ] as const)('allows an active privileged actor and preserves version', async (role, actor) => {
      const context = setup(role, actor);
      await expect(
        context.service.approve(actor, 'transcript-1', { expectedVersion: 1 }, 'idem-1', 'req-1'),
      ).resolves.toMatchObject({
        transcript: { status: 'APPROVED', version: 1, approvedVersion: 1 },
        aiJob: { aiJobId: 'aij-1' },
      });
      expect(context.repository.approve).toHaveBeenCalledWith(
        expect.objectContaining({ artifactChecksum: 'checksum' }),
      );
    });

    it('rejects ordinary and inactive members', async () => {
      await expect(
        setup().service.approve('member-1', 'transcript-1', { expectedVersion: 1 }, 'idem', 'req'),
      ).rejects.toMatchObject({ statusCode: 403 });
      const inactive = setup(GroupRole.GROUP_ADMIN, 'admin-1');
      inactive.memberships.getMembership.mockResolvedValue({
        groupId: 'group-1',
        userId: 'admin-1',
        role: GroupRole.GROUP_ADMIN,
        active: false,
      });
      await expect(
        inactive.service.approve('admin-1', 'transcript-1', { expectedVersion: 1 }, 'idem', 'req'),
      ).rejects.toMatchObject({ statusCode: 403 });
    });

    it('rejects stale version and wrong lifecycle before freezing', async () => {
      const stale = setup(GroupRole.GROUP_ADMIN, 'admin-1');
      await expect(
        stale.service.approve('admin-1', 'transcript-1', { expectedVersion: 2 }, 'idem', 'req'),
      ).rejects.toMatchObject({ statusCode: 409 });
      const live = setup(GroupRole.GROUP_ADMIN, 'admin-1');
      live.repository.getById = vi.fn().mockResolvedValue({ ...transcript, status: 'LIVE' });
      await expect(
        live.service.approve('admin-1', 'transcript-1', { expectedVersion: 1 }, 'idem', 'req'),
      ).rejects.toMatchObject({ statusCode: 422 });
      expect(stale.objects.writeImmutable).not.toHaveBeenCalled();
      expect(live.objects.writeImmutable).not.toHaveBeenCalled();
    });

    it('freezes deterministic UTF-8 content before transaction and starts after commit', async () => {
      const context = setup(GroupRole.GROUP_ADMIN, 'admin-1');
      await context.service.approve(
        'admin-1',
        'transcript-1',
        { expectedVersion: 1 },
        'idem',
        'req',
      );
      expect(context.objects.writeImmutable).toHaveBeenCalledWith({
        objectKey: 'uploads/group-1/meeting-1/transcripts/transcript-1/v1/content.txt',
        content: Buffer.from('Speaker 1: Xin chào\n', 'utf8'),
        contentType: 'text/plain',
      });
      expect(context.jobs.prepareJob).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'INGEST_SOURCE',
          payload: expect.objectContaining({
            sourceType: 'TRANSCRIPT',
            sourceVersion: 1,
            approved: true,
          }),
        }),
      );
      const approve = context.repository.approve as ReturnType<typeof vi.fn>;
      expect(context.objects.writeImmutable.mock.invocationCallOrder[0]).toBeLessThan(
        approve.mock.invocationCallOrder[0]!,
      );
      expect(approve.mock.invocationCallOrder[0]).toBeLessThan(
        context.jobs.ensureStarted.mock.invocationCallOrder[0]!,
      );
    });

    it('replays an approved handoff and retries the same job after start failure', async () => {
      const context = setup(GroupRole.GROUP_ADMIN, 'admin-1');
      context.jobs.ensureStarted.mockRejectedValueOnce(new Error('start failed'));
      await expect(
        context.service.approve('admin-1', 'transcript-1', { expectedVersion: 1 }, 'idem', 'req'),
      ).rejects.toThrow('start failed');
      context.repository.getById = vi.fn().mockResolvedValue(context.approvedTranscript);
      context.jobs.ensureStarted.mockResolvedValueOnce(queuedJob);
      await context.service.approve(
        'admin-1',
        'transcript-1',
        { expectedVersion: 1 },
        'different-key',
        'req-2',
      );
      expect(context.repository.approve).toHaveBeenCalledTimes(1);
      expect(context.jobs.ensureStarted).toHaveBeenNthCalledWith(1, 'aij-1');
      expect(context.jobs.ensureStarted).toHaveBeenNthCalledWith(2, 'aij-1');
      expect(context.objects.writeImmutable).toHaveBeenCalledTimes(1);
    });

    it('leaves a reusable frozen artifact when the transaction fails', async () => {
      const context = setup(GroupRole.GROUP_ADMIN, 'admin-1');
      const transactionError = new Error('database unavailable');
      (context.repository.approve as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(transactionError)
        .mockResolvedValueOnce({
          transcript: context.approvedTranscript,
          handoff: context.handoff,
          created: true,
        });
      await expect(
        context.service.approve('admin-1', 'transcript-1', { expectedVersion: 1 }, 'idem', 'req'),
      ).rejects.toBe(transactionError);
      context.objects.writeImmutable.mockResolvedValueOnce({
        objectKey: context.handoff.artifactObjectKey,
        sha256: 'checksum',
        sizeBytes: 20,
        replayed: true,
      });
      await context.service.approve(
        'admin-1',
        'transcript-1',
        { expectedVersion: 1 },
        'idem',
        'req-2',
      );
      expect(context.objects.writeImmutable).toHaveBeenCalledTimes(2);
      expect(context.jobs.ensureStarted).toHaveBeenCalledWith('aij-1');
    });
  });
});
