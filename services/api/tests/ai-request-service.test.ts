import type { AIJob, AIRequestPayload } from '@campusmeet/shared';
import { describe, expect, it, vi } from 'vitest';
import { AIRequestService } from '../src/ai/request-service';
import type { AIJobOrchestrator, MeetingScopeReader, MembershipAuthorizer } from '../src/ai/ports';

const queuedJob: AIJob = {
  aiJobId: 'aij-1',
  groupId: 'group-1',
  type: 'GENERATE_ANSWER',
  status: 'QUEUED',
  attempt: 0,
  requestId: 'request-1',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

const setup = () => {
  const access: MembershipAuthorizer = {
    requireMember: vi.fn().mockResolvedValue(undefined),
    requireGroupAdmin: vi.fn().mockResolvedValue(undefined),
    requireMeetingOrganizerOrAdmin: vi.fn().mockResolvedValue('group-1'),
  };
  const meetings: MeetingScopeReader = {
    getMeetingGroupId: vi.fn().mockResolvedValue('group-1'),
    requireMeetingsInGroup: vi.fn().mockResolvedValue(undefined),
  };
  const jobs: AIJobOrchestrator = {
    enqueue: vi.fn().mockResolvedValue(queuedJob),
    ensureStarted: vi.fn().mockResolvedValue(queuedJob),
  };
  const snapshots = {
    getVersion: vi.fn().mockResolvedValue({ groupId: 'group-1', version: 4 }),
    generate: vi.fn().mockResolvedValue({ groupId: 'group-1', version: 5 }),
  };
  const jobReplays = { findExisting: vi.fn().mockResolvedValue(null) };
  return {
    access,
    meetings,
    jobs,
    snapshots,
    jobReplays,
    service: new AIRequestService(access, meetings, jobs, snapshots, jobReplays),
  };
};

describe('AI request service', () => {
  it('authorizes a meeting chat before creating a scoped job', async () => {
    const { access, jobs, service } = setup();

    await service.requestMeetingChat({
      actorId: 'user-1',
      meetingId: 'meeting-1',
      request: { question: 'Đã thống nhất điều gì?', intent: 'QUESTION_ANSWER' },
      idempotencyKey: 'idem-1',
      requestId: 'request-1',
    });

    expect(access.requireMember).toHaveBeenCalledWith('user-1', 'group-1');
    const payload = vi.mocked(jobs.enqueue).mock.calls[0]?.[0].payload as AIRequestPayload;
    expect(payload).toMatchObject({
      operation: 'MEETING_CHAT',
      groupId: 'group-1',
      meetingId: 'meeting-1',
    });
  });

  it('validates every selected meeting before enqueuing group search', async () => {
    const { meetings, jobs, service } = setup();

    await service.requestGroupSearch({
      actorId: 'user-1',
      groupId: 'group-1',
      request: {
        question: 'Tìm quyết định',
        scope: 'SELECTED_MEETINGS',
        meetingIds: ['meeting-1', 'meeting-2'],
      },
      idempotencyKey: 'idem-2',
      requestId: 'request-2',
    });

    expect(meetings.requireMeetingsInGroup).toHaveBeenCalledWith(
      ['meeting-1', 'meeting-2'],
      'group-1',
    );
    expect(jobs.enqueue).toHaveBeenCalledOnce();
  });

  it('does not enqueue selected-meeting search when one meeting is outside the group', async () => {
    const { meetings, jobs, service } = setup();
    vi.mocked(meetings.requireMeetingsInGroup).mockRejectedValue(new Error('CROSS_GROUP_MEETING'));

    await expect(
      service.requestGroupSearch({
        actorId: 'user-1',
        groupId: 'group-1',
        request: {
          question: 'Tìm quyết định',
          scope: 'SELECTED_MEETINGS',
          meetingIds: ['meeting-1', 'meeting-from-another-group'],
        },
        idempotencyKey: 'idem-cross-group',
        requestId: 'request-cross-group',
      }),
    ).rejects.toThrow('CROSS_GROUP_MEETING');

    expect(jobs.enqueue).not.toHaveBeenCalled();
  });

  it('does not enqueue whole-group search when membership authorization fails', async () => {
    const { access, jobs, service } = setup();
    vi.mocked(access.requireMember).mockRejectedValue(new Error('FORBIDDEN'));

    await expect(
      service.requestGroupSearch({
        actorId: 'outsider-1',
        groupId: 'group-1',
        request: { question: 'Tìm quyết định', scope: 'WHOLE_GROUP' },
        idempotencyKey: 'idem-forbidden',
        requestId: 'request-forbidden',
      }),
    ).rejects.toThrow('FORBIDDEN');

    expect(jobs.enqueue).not.toHaveBeenCalled();
  });

  it('requires Group Admin before progress analysis', async () => {
    const { access, jobs, service } = setup();

    await service.requestProgressAnalysis({
      actorId: 'admin-1',
      groupId: 'group-1',
      request: {},
      idempotencyKey: 'idem-3',
      requestId: 'request-3',
    });

    expect(access.requireGroupAdmin).toHaveBeenCalledWith('admin-1', 'group-1');
    expect(jobs.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        groupId: 'group-1',
        type: 'PROGRESS_ANALYSIS',
        payload: expect.objectContaining({
          operation: 'PROGRESS_ANALYSIS',
          request: { snapshotVersion: 5 },
        }),
      }),
    );
  });

  it('does not inspect replay or snapshots when Group Admin authorization fails', async () => {
    const { access, service, snapshots, jobs, jobReplays } = setup();
    vi.mocked(access.requireGroupAdmin).mockRejectedValue(new Error('FORBIDDEN'));

    await expect(
      service.requestProgressAnalysis({
        actorId: 'member-1',
        groupId: 'group-1',
        request: {},
        idempotencyKey: 'idem-forbidden-progress',
        requestId: 'request-forbidden-progress',
      }),
    ).rejects.toThrow('FORBIDDEN');

    expect(jobReplays.findExisting).not.toHaveBeenCalled();
    expect(snapshots.generate).not.toHaveBeenCalled();
    expect(jobs.enqueue).not.toHaveBeenCalled();
  });

  it('resolves an explicitly requested immutable snapshot without generating', async () => {
    const { service, snapshots, jobs } = setup();

    await service.requestProgressAnalysis({
      actorId: 'admin-1',
      groupId: 'group-1',
      request: { snapshotVersion: 4 },
      idempotencyKey: 'idem-explicit',
      requestId: 'request-explicit',
    });

    expect(snapshots.getVersion).toHaveBeenCalledWith('group-1', 4);
    expect(snapshots.generate).not.toHaveBeenCalled();
    expect(jobs.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ request: { snapshotVersion: 4 } }),
      }),
    );
  });

  it('does not enqueue when an explicit immutable snapshot cannot be resolved', async () => {
    const { service, snapshots, jobs } = setup();
    snapshots.getVersion.mockRejectedValue(new Error('GROUP_PROGRESS_SNAPSHOT_NOT_FOUND'));

    await expect(
      service.requestProgressAnalysis({
        actorId: 'admin-1',
        groupId: 'group-1',
        request: { snapshotVersion: 7 },
        idempotencyKey: 'idem-missing-version',
        requestId: 'request-missing-version',
      }),
    ).rejects.toThrow('GROUP_PROGRESS_SNAPSHOT_NOT_FOUND');

    expect(snapshots.generate).not.toHaveBeenCalled();
    expect(jobs.enqueue).not.toHaveBeenCalled();
  });

  it('generates before enqueue and does not enqueue when snapshot generation fails', async () => {
    const { service, snapshots, jobs } = setup();
    snapshots.generate.mockRejectedValue(new Error('SNAPSHOT_FAILED'));

    await expect(
      service.requestProgressAnalysis({
        actorId: 'admin-1',
        groupId: 'group-1',
        request: {},
        idempotencyKey: 'idem-failed',
        requestId: 'request-failed',
      }),
    ).rejects.toThrow('SNAPSHOT_FAILED');
    expect(jobs.enqueue).not.toHaveBeenCalled();
  });

  it('surfaces enqueue failure after a snapshot was successfully resolved', async () => {
    const { service, snapshots, jobs } = setup();
    vi.mocked(jobs.enqueue).mockRejectedValue(new Error('AI_JOB_PERSIST_FAILED'));

    await expect(
      service.requestProgressAnalysis({
        actorId: 'admin-1',
        groupId: 'group-1',
        request: {},
        idempotencyKey: 'idem-enqueue-failed',
        requestId: 'request-enqueue-failed',
      }),
    ).rejects.toThrow('AI_JOB_PERSIST_FAILED');

    expect(snapshots.generate).toHaveBeenCalledOnce();
    expect(jobs.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ request: { snapshotVersion: 5 } }),
      }),
    );
  });

  it('returns an existing idempotent job before resolving a different snapshot', async () => {
    const { service, snapshots, jobs, jobReplays } = setup();
    jobReplays.findExisting.mockResolvedValue({
      job: queuedJob,
      payload: {
        operation: 'PROGRESS_ANALYSIS',
        actorId: 'admin-1',
        groupId: 'group-1',
        request: { snapshotVersion: 4 },
      },
    });

    await expect(
      service.requestProgressAnalysis({
        actorId: 'admin-1',
        groupId: 'group-1',
        request: {},
        idempotencyKey: 'idem-replay',
        requestId: 'request-replay',
      }),
    ).resolves.toBe(queuedJob);

    expect(jobReplays.findExisting).toHaveBeenCalledWith({
      actorId: 'admin-1',
      groupId: 'group-1',
      operation: 'PROGRESS_ANALYSIS',
      idempotencyKey: 'idem-replay',
    });
    expect(snapshots.generate).not.toHaveBeenCalled();
    expect(snapshots.getVersion).not.toHaveBeenCalled();
    expect(jobs.enqueue).not.toHaveBeenCalled();
  });

  it('fails safely when an existing progress job is not bound to an exact snapshot version', async () => {
    const { service, snapshots, jobs, jobReplays } = setup();
    jobReplays.findExisting.mockResolvedValue({
      job: queuedJob,
      payload: {
        operation: 'PROGRESS_ANALYSIS',
        actorId: 'admin-1',
        groupId: 'group-1',
        request: {},
      },
    });

    await expect(
      service.requestProgressAnalysis({
        actorId: 'admin-1',
        groupId: 'group-1',
        request: {},
        idempotencyKey: 'idem-legacy',
        requestId: 'request-legacy',
      }),
    ).rejects.toThrow('AI_IDEMPOTENCY_DATA_INTEGRITY');
    expect(snapshots.generate).not.toHaveBeenCalled();
    expect(jobs.enqueue).not.toHaveBeenCalled();
  });

  it('does not perform progress snapshot work for other AI request types', async () => {
    const { service, snapshots, jobReplays } = setup();

    await service.requestGroupSearch({
      actorId: 'user-1',
      groupId: 'group-1',
      request: { question: 'Tìm quyết định', scope: 'WHOLE_GROUP' },
      idempotencyKey: 'idem-search',
      requestId: 'request-search',
    });

    expect(snapshots.generate).not.toHaveBeenCalled();
    expect(snapshots.getVersion).not.toHaveBeenCalled();
    expect(jobReplays.findExisting).not.toHaveBeenCalled();
  });

  it.each([
    ['minutes draft', 'requestMinutesDraft', 'GENERATE_MINUTES', 'MINUTES_DRAFT'],
    ['task proposals', 'requestTaskProposals', 'GENERATE_TASK_PROPOSALS', 'TASK_PROPOSALS'],
  ] as const)(
    'authorizes organizer/admin and queues %s without mutating M3 data',
    async (_label, method, type, operation) => {
      const { access, jobs, service } = setup();

      await service[method]({
        actorId: 'organizer-1',
        meetingId: 'meeting-1',
        request: {},
        idempotencyKey: `idem-${operation}`,
        requestId: `request-${operation}`,
      });

      expect(access.requireMeetingOrganizerOrAdmin).toHaveBeenCalledWith(
        'organizer-1',
        'meeting-1',
      );
      expect(jobs.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          groupId: 'group-1',
          meetingId: 'meeting-1',
          type,
          payload: expect.objectContaining({ operation }),
        }),
      );
    },
  );
});
