import {
  GoogleSyncStatus,
  IntegrationStatus,
  MeetingStatus,
  Priority,
  TaskStatus,
  type GroupProgressSnapshot,
  type Meeting,
  type Task,
} from '@campusmeet/shared';
import { describe, expect, it, vi } from 'vitest';
import { SnapshotPublishConflictError } from '../src/repositories/group-progress-snapshots';
import { GroupProgressSnapshotService } from '../src/services/group-progress-snapshot-service';

const cutoff = '2026-08-08T10:00:00.000Z';
const snapshot = (version: number): GroupProgressSnapshot => ({
  groupId: 'group-1',
  version,
  generatedAt: cutoff,
  taskCounts: { total: 0, todo: 0, doing: 0, done: 0, overdue: 0 },
  meetingCounts: { completed: 0, upcoming: 0 },
});
const task = (status: TaskStatus, dueAt?: string): Task => ({
  id: `${status}-${dueAt ?? 'none'}`,
  groupId: 'group-1',
  title: 'Task',
  assigneeId: 'user-1',
  priority: Priority.MEDIUM,
  status,
  ...(dueAt ? { dueAt } : {}),
});
const meeting = (status: MeetingStatus, startsAt: string): Meeting => ({
  id: `${status}-${startsAt}`,
  groupId: 'group-1',
  title: 'Meeting',
  organizerId: 'admin-1',
  attendeeIds: [],
  agenda: [],
  startsAt,
  endsAt: '2026-08-09T12:00:00.000Z',
  status,
  googleSyncStatus: GoogleSyncStatus.NOT_REQUESTED,
  integrationStatus: IntegrationStatus.NOT_CONNECTED,
  createdAt: '2026-08-01T00:00:00.000Z',
  createdBy: 'admin-1',
  updatedAt: '2026-08-01T00:00:00.000Z',
  updatedBy: 'admin-1',
  version: 1,
});

const setup = () => {
  const snapshots = {
    getLatest: vi.fn().mockResolvedValue(null),
    getVersion: vi.fn(),
    publish: vi.fn().mockResolvedValue(undefined),
  };
  const tasks = { listByGroup: vi.fn().mockResolvedValue([]) };
  const meetings = {
    listByGroup: vi.fn().mockResolvedValue({ items: [] }),
  };
  const clock = vi.fn(() => new Date(cutoff));
  const generationId = vi.fn(() => 'generation-1');
  return {
    snapshots,
    tasks,
    meetings,
    clock,
    generationId,
    service: new GroupProgressSnapshotService(snapshots, tasks, meetings, clock, generationId),
  };
};

describe('GroupProgressSnapshotService', () => {
  it('publishes version 1 with zero counts for an empty group', async () => {
    const { service, snapshots, tasks, meetings, clock } = setup();

    await expect(service.generate('group-1')).resolves.toEqual(snapshot(1));
    expect(tasks.listByGroup).toHaveBeenCalledWith('group-1');
    expect(meetings.listByGroup).toHaveBeenCalledWith('group-1', 100, undefined);
    expect(snapshots.publish).toHaveBeenCalledWith(snapshot(1), 0, 'generation-1');
    expect(clock).toHaveBeenCalledOnce();
  });

  it('counts task status and overdue semantics at one injected cutoff', async () => {
    const { service, tasks } = setup();
    tasks.listByGroup.mockResolvedValue([
      task(TaskStatus.TODO, '2026-08-08T09:59:59.999Z'),
      task(TaskStatus.TODO, cutoff),
      task(TaskStatus.DOING, '2026-08-08T16:59:59.999+07:00'),
      task(TaskStatus.DOING),
      task(TaskStatus.DONE, '2026-08-01T00:00:00.000Z'),
    ]);

    const result = await service.generate('group-1');

    expect(result.taskCounts).toEqual({ total: 5, todo: 2, doing: 2, done: 1, overdue: 2 });
    expect(result.generatedAt).toBe(cutoff);
  });

  it('counts completed and future scheduled meetings while excluding other states', async () => {
    const { service, meetings } = setup();
    meetings.listByGroup.mockResolvedValue({
      items: [
        meeting(MeetingStatus.COMPLETED, '2026-08-01T00:00:00.000Z'),
        meeting(MeetingStatus.SCHEDULED, cutoff),
        meeting(MeetingStatus.SCHEDULED, '2026-08-08T09:59:59.999Z'),
        meeting(MeetingStatus.DRAFT, '2026-08-09T00:00:00.000Z'),
        meeting(MeetingStatus.CANCELLED, '2026-08-09T00:00:00.000Z'),
      ],
    });

    await expect(service.generate('group-1')).resolves.toMatchObject({
      meetingCounts: { completed: 1, upcoming: 1 },
    });
  });

  it('loads every Meeting page and rejects a repeated cursor', async () => {
    const { service, meetings } = setup();
    meetings.listByGroup
      .mockResolvedValueOnce({
        items: [meeting(MeetingStatus.COMPLETED, '2026-08-01T00:00:00.000Z')],
        nextCursor: 'cursor-1',
      })
      .mockResolvedValueOnce({ items: [], nextCursor: 'cursor-1' });

    await expect(service.generate('group-1')).rejects.toThrow(
      'Meeting pagination cursor did not advance.',
    );
  });

  it('aggregates all successful Meeting pages', async () => {
    const { service, meetings } = setup();
    meetings.listByGroup
      .mockResolvedValueOnce({
        items: [meeting(MeetingStatus.COMPLETED, '2026-08-01T00:00:00.000Z')],
        nextCursor: 'cursor-1',
      })
      .mockResolvedValueOnce({
        items: [meeting(MeetingStatus.SCHEDULED, '2026-08-09T00:00:00.000Z')],
      });

    await expect(service.generate('group-1')).resolves.toMatchObject({
      meetingCounts: { completed: 1, upcoming: 1 },
    });
    expect(meetings.listByGroup).toHaveBeenNthCalledWith(2, 'group-1', 100, 'cursor-1');
  });

  it('increments the latest version and resolves exact immutable versions', async () => {
    const { service, snapshots } = setup();
    snapshots.getLatest.mockResolvedValue(snapshot(4));
    snapshots.getVersion.mockResolvedValue(snapshot(3));

    await expect(service.generate('group-1')).resolves.toMatchObject({ version: 5 });
    await expect(service.getVersion('group-1', 3)).resolves.toEqual(snapshot(3));
    expect(snapshots.publish).toHaveBeenCalledWith(
      expect.objectContaining({ version: 5 }),
      4,
      'generation-1',
    );
  });

  it('fails safely when an exact version is absent or version space is exhausted', async () => {
    const { service, snapshots } = setup();
    snapshots.getVersion.mockResolvedValue(null);
    await expect(service.getVersion('group-1', 2)).rejects.toThrow(
      'GROUP_PROGRESS_SNAPSHOT_NOT_FOUND',
    );

    snapshots.getLatest.mockResolvedValue(snapshot(9_999_999_999));
    await expect(service.generate('group-1')).rejects.toThrow(
      'GROUP_PROGRESS_SNAPSHOT_VERSION_EXHAUSTED',
    );
    expect(snapshots.publish).not.toHaveBeenCalled();
  });

  it('fully recomputes with a new cutoff after a concurrent writer wins', async () => {
    const { snapshots, tasks, meetings } = setup();
    const secondCutoff = '2026-08-08T10:05:00.000Z';
    snapshots.getLatest.mockResolvedValueOnce(snapshot(1)).mockResolvedValueOnce(snapshot(2));
    snapshots.publish
      .mockRejectedValueOnce(new SnapshotPublishConflictError())
      .mockResolvedValueOnce(undefined);
    tasks.listByGroup
      .mockResolvedValueOnce([task(TaskStatus.TODO)])
      .mockResolvedValueOnce([task(TaskStatus.DONE)]);
    const clock = vi
      .fn<() => Date>()
      .mockReturnValueOnce(new Date(cutoff))
      .mockReturnValueOnce(new Date(secondCutoff));
    const generationId = vi
      .fn<() => string>()
      .mockReturnValueOnce('generation-1')
      .mockReturnValueOnce('generation-2');
    const service = new GroupProgressSnapshotService(
      snapshots,
      tasks,
      meetings,
      clock,
      generationId,
    );

    const result = await service.generate('group-1');

    expect(result).toMatchObject({
      version: 3,
      generatedAt: secondCutoff,
      taskCounts: { total: 1, todo: 0, doing: 0, done: 1, overdue: 0 },
    });
    expect(tasks.listByGroup).toHaveBeenCalledTimes(2);
    expect(meetings.listByGroup).toHaveBeenCalledTimes(2);
    expect(snapshots.publish).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ version: 3, generatedAt: secondCutoff }),
      2,
      'generation-2',
    );
  });

  it('bounds contention retries without returning an unpublished snapshot', async () => {
    const { snapshots, tasks, meetings } = setup();
    snapshots.publish.mockRejectedValue(new SnapshotPublishConflictError());
    const service = new GroupProgressSnapshotService(
      snapshots,
      tasks,
      meetings,
      () => new Date(cutoff),
      () => 'generation',
      2,
    );

    await expect(service.generate('group-1')).rejects.toThrow(
      'GROUP_PROGRESS_SNAPSHOT_CONTENTION_EXHAUSTED',
    );
    expect(snapshots.publish).toHaveBeenCalledTimes(2);
  });

  it('does not publish when a source query fails', async () => {
    const { service, tasks, snapshots } = setup();
    tasks.listByGroup.mockRejectedValue(new Error('TASK_QUERY_FAILED'));

    await expect(service.generate('group-1')).rejects.toThrow('TASK_QUERY_FAILED');
    expect(snapshots.publish).not.toHaveBeenCalled();
  });

  it('does not publish when the Meeting source query fails', async () => {
    const { service, meetings, snapshots } = setup();
    meetings.listByGroup.mockRejectedValue(new Error('MEETING_QUERY_FAILED'));

    await expect(service.generate('group-1')).rejects.toThrow('MEETING_QUERY_FAILED');
    expect(snapshots.publish).not.toHaveBeenCalled();
  });

  it('does not return a snapshot when publishing fails', async () => {
    const { service, snapshots } = setup();
    snapshots.publish.mockRejectedValue(new Error('DYNAMODB_UNAVAILABLE'));

    await expect(service.generate('group-1')).rejects.toThrow('DYNAMODB_UNAVAILABLE');
  });

  it('rejects malformed or cross-group Meeting source records', async () => {
    const { service, meetings, snapshots } = setup();
    meetings.listByGroup.mockResolvedValue({
      items: [{ ...meeting(MeetingStatus.SCHEDULED, cutoff), groupId: 'group-2' }],
    });

    await expect(service.generate('group-1')).rejects.toThrow(
      'GROUP_PROGRESS_MEETING_DATA_INTEGRITY',
    );
    expect(snapshots.publish).not.toHaveBeenCalled();
  });
});
