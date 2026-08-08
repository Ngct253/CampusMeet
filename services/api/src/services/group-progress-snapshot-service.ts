import { randomUUID } from 'node:crypto';
import {
  MeetingStatus,
  TaskStatus,
  groupProgressSnapshotSchema,
  type GroupProgressSnapshot,
  type Meeting,
} from '@campusmeet/shared';
import { z } from 'zod';
import type {
  GroupProgressSnapshotProvider,
  GroupProgressSnapshotRepository,
  GroupTaskReader,
  MeetingPage,
} from '../domain/ports';
import { SnapshotPublishConflictError } from '../repositories/group-progress-snapshots';

const MAX_SNAPSHOT_VERSION = 9_999_999_999;
const MEETING_PAGE_SIZE = 100;
const dateTimeSchema = z.string().datetime({ offset: true });

interface GroupMeetingReader {
  listByGroup(groupId: string, limit?: number, cursor?: string): Promise<MeetingPage>;
}

const assertMeetingSource = (meeting: Meeting, groupId: string) => {
  if (
    !meeting.id ||
    meeting.id === 'undefined' ||
    meeting.groupId !== groupId ||
    !Object.values(MeetingStatus).includes(meeting.status) ||
    !dateTimeSchema.safeParse(meeting.startsAt).success
  ) {
    throw new Error('GROUP_PROGRESS_MEETING_DATA_INTEGRITY');
  }
};

export class GroupProgressSnapshotService implements GroupProgressSnapshotProvider {
  constructor(
    private readonly snapshots: GroupProgressSnapshotRepository,
    private readonly tasks: GroupTaskReader,
    private readonly meetings: GroupMeetingReader,
    private readonly clock: () => Date = () => new Date(),
    private readonly generationId: () => string = randomUUID,
    private readonly maxPublishAttempts = 3,
  ) {
    if (!Number.isInteger(maxPublishAttempts) || maxPublishAttempts < 1) {
      throw new Error('GROUP_PROGRESS_SNAPSHOT_RETRY_CONFIGURATION_INVALID');
    }
  }

  async getVersion(groupId: string, version: number): Promise<GroupProgressSnapshot> {
    const snapshot = await this.snapshots.getVersion(groupId, version);
    if (!snapshot) throw new Error('GROUP_PROGRESS_SNAPSHOT_NOT_FOUND');
    return snapshot;
  }

  async generate(groupId: string): Promise<GroupProgressSnapshot> {
    for (let attempt = 0; attempt < this.maxPublishAttempts; attempt += 1) {
      const latest = await this.snapshots.getLatest(groupId);
      const previousVersion = latest?.version ?? 0;
      if (previousVersion >= MAX_SNAPSHOT_VERSION) {
        throw new Error('GROUP_PROGRESS_SNAPSHOT_VERSION_EXHAUSTED');
      }

      const generatedAt = this.clock().toISOString();
      const [tasks, meetings] = await Promise.all([
        this.tasks.listByGroup(groupId),
        this.listAllMeetings(groupId),
      ]);
      const snapshot = groupProgressSnapshotSchema.parse({
        groupId,
        version: previousVersion + 1,
        generatedAt,
        taskCounts: {
          total: tasks.length,
          todo: tasks.filter((task) => task.status === TaskStatus.TODO).length,
          doing: tasks.filter((task) => task.status === TaskStatus.DOING).length,
          done: tasks.filter((task) => task.status === TaskStatus.DONE).length,
          overdue: tasks.filter(
            (task) =>
              task.status !== TaskStatus.DONE &&
              task.dueAt !== undefined &&
              Date.parse(task.dueAt) < Date.parse(generatedAt),
          ).length,
        },
        meetingCounts: {
          completed: meetings.filter((meeting) => meeting.status === MeetingStatus.COMPLETED)
            .length,
          upcoming: meetings.filter(
            (meeting) =>
              meeting.status === MeetingStatus.SCHEDULED &&
              Date.parse(meeting.startsAt) >= Date.parse(generatedAt),
          ).length,
        },
      });

      try {
        await this.snapshots.publish(snapshot, previousVersion, this.generationId());
        return snapshot;
      } catch (error) {
        if (!(error instanceof SnapshotPublishConflictError)) throw error;
      }
    }

    throw new Error('GROUP_PROGRESS_SNAPSHOT_CONTENTION_EXHAUSTED');
  }

  private async listAllMeetings(groupId: string): Promise<Meeting[]> {
    const meetings: Meeting[] = [];
    const seenCursors = new Set<string>();
    let cursor: string | undefined;

    do {
      const page = await this.meetings.listByGroup(groupId, MEETING_PAGE_SIZE, cursor);
      for (const meeting of page.items) assertMeetingSource(meeting, groupId);
      meetings.push(...page.items);

      const nextCursor = page.nextCursor;
      if (nextCursor && (nextCursor === cursor || seenCursors.has(nextCursor))) {
        throw new Error('Meeting pagination cursor did not advance.');
      }
      if (nextCursor) seenCursors.add(nextCursor);
      cursor = nextCursor;
    } while (cursor);

    return meetings;
  }
}
