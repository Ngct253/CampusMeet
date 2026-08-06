import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GoogleSyncStatus,
  IntegrationStatus,
  MeetingStatus,
  Priority,
  TaskStatus,
  type Meeting,
  type MeetingMinutes,
  type Task,
} from '@campusmeet/shared';

const send = vi.hoisted(() => vi.fn());
vi.mock('../src/repositories/client', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/repositories/client')>();
  return { ...original, documentClient: { send } };
});

import { DynamoDbActionItemTaskRepository } from '../src/repositories/action-item-tasks';

const meeting: Meeting = {
  id: 'meeting-1',
  groupId: 'group-1',
  title: 'Họp tuần',
  organizerId: 'admin-1',
  attendeeIds: ['admin-1', 'user-1'],
  agenda: [],
  startsAt: '2026-08-04T01:00:00.000Z',
  endsAt: '2026-08-04T02:00:00.000Z',
  status: MeetingStatus.COMPLETED,
  googleSyncStatus: GoogleSyncStatus.NOT_REQUESTED,
  integrationStatus: IntegrationStatus.READY,
  createdAt: '2026-08-04T00:00:00.000Z',
  createdBy: 'admin-1',
  updatedAt: '2026-08-04T00:00:00.000Z',
  updatedBy: 'admin-1',
  version: 1,
};

const minutes: MeetingMinutes = {
  id: 'minutes-1',
  meetingId: meeting.id,
  groupId: meeting.groupId,
  summary: 'Tóm tắt',
  discussion: 'Thảo luận',
  decisions: [{ id: 'decision-1', content: 'Quyết định' }],
  actionItems: [
    {
      id: 'action-1',
      content: 'Hoàn thiện báo cáo',
      assigneeId: 'user-1',
      dueAt: '2026-08-10T03:30:00.000Z',
    },
    { id: 'action-2', content: 'Giữ nguyên' },
  ],
  version: 7,
  createdBy: 'previous-admin',
  createdAt: '2026-08-04T03:00:00.000Z',
};

const write = {
  actorId: 'admin-1',
  meeting,
  minutes,
  actionItemId: 'action-1',
  title: 'Task xác nhận',
  assigneeId: 'user-1',
  priority: Priority.HIGH,
};

const taskId = createHash('sha256')
  .update(JSON.stringify(['ACTION_ITEM_TASK', 'meeting-1', 'action-1']))
  .digest('hex')
  .slice(0, 32);
const now = new Date('2026-08-06T05:00:00.000Z');

describe('DynamoDbActionItemTaskRepository', () => {
  beforeEach(() => {
    send.mockReset();
    process.env.TASK_DATA_TABLE = 'campusmeet-test-task-data';
    process.env.MEETING_DATA_TABLE = 'campusmeet-test-meeting-data';
  });

  it('atomically puts exactly one Task and immutable Minutes N+1 with source identity', async () => {
    send.mockResolvedValueOnce({});
    const repository = new DynamoDbActionItemTaskRepository(
      { getLatest: vi.fn() },
      { getById: vi.fn() },
      () => now,
    );
    const result = await repository.create(write);
    const command = send.mock.calls[0]?.[0] as {
      constructor: { name: string };
      input: {
        TransactItems: Array<{
          Put?: { TableName: string; Item: Record<string, unknown>; ConditionExpression: string };
        }>;
      };
    };

    expect(command.constructor.name).toBe('TransactWriteCommand');
    expect(command.input.TransactItems).toHaveLength(2);
    const taskPut = command.input.TransactItems[0]?.Put;
    const minutesPut = command.input.TransactItems[1]?.Put;
    expect(taskPut).toMatchObject({
      TableName: 'campusmeet-test-task-data',
      ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
      Item: {
        PK: `TASK#${taskId}`,
        SK: 'META',
        entityType: 'TASK',
        id: taskId,
        groupId: 'group-1',
        title: 'Task xác nhận',
        assigneeId: 'user-1',
        priority: Priority.HIGH,
        status: TaskStatus.TODO,
        dueAt: '2026-08-10T03:30:00.000Z',
        sourceMeetingId: 'meeting-1',
        sourceActionItemId: 'action-1',
        createdBy: 'admin-1',
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
        version: 1,
        GSI1PK: 'GROUP#group-1',
        GSI1SK: `STATUS#TODO#DUE#2026-08-10T03:30:00.000Z#TASK#${taskId}`,
        GSI2PK: 'USER#user-1',
        GSI2SK: `DUE#2026-08-10T03:30:00.000Z#TASK#${taskId}`,
        GSI3PK: 'MEETING#meeting-1',
        GSI3SK: `TASK#${now.toISOString()}#${taskId}`,
      },
    });
    expect(minutesPut).toMatchObject({
      TableName: 'campusmeet-test-meeting-data',
      ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
      Item: {
        PK: 'MEETING#meeting-1',
        SK: 'MINUTES#VERSION#000008',
        entityType: 'MEETING_MINUTES',
        id: 'minutes-1',
        summary: minutes.summary,
        discussion: minutes.discussion,
        decisions: minutes.decisions,
        version: 8,
        createdBy: 'admin-1',
        createdAt: now.toISOString(),
      },
    });
    expect(minutesPut?.Item.actionItems).toEqual([
      { ...minutes.actionItems[0], taskId },
      minutes.actionItems[1],
    ]);
    expect(result).toEqual({
      task: expect.objectContaining({ id: taskId }),
      minutes: expect.objectContaining({ version: 8 }),
    });
    expect(
      command.input.TransactItems.some(({ Put }) => String(Put?.Item.SK).startsWith('EVENT#')),
    ).toBe(false);
    expect(send.mock.calls.flat().some((item) => item?.constructor?.name === 'ScanCommand')).toBe(
      false,
    );
  });

  it('uses the no-due sentinel only in Task indexes', async () => {
    send.mockResolvedValueOnce({});
    const noDueMinutes = {
      ...minutes,
      actionItems: [{ id: 'action-1', content: 'Task', assigneeId: 'user-1' }],
    };
    const result = await new DynamoDbActionItemTaskRepository(
      { getLatest: vi.fn() },
      { getById: vi.fn() },
      () => now,
    ).create({ ...write, minutes: noDueMinutes });
    const taskItem = (
      send.mock.calls[0]?.[0] as {
        input: { TransactItems: Array<{ Put: { Item: Record<string, unknown> } }> };
      }
    ).input.TransactItems[0]!.Put.Item;
    expect(taskItem).not.toHaveProperty('dueAt');
    expect(taskItem.GSI1SK).toContain('DUE#9999-12-31T23:59:59.999Z');
    expect(taskItem.GSI2SK).toContain('DUE#9999-12-31T23:59:59.999Z');
    expect(result.task.dueAt).toBeUndefined();
  });

  it('generates the same Task ID for the same meeting and Action Item regardless of actor', async () => {
    send.mockResolvedValue({});
    const repository = new DynamoDbActionItemTaskRepository(
      { getLatest: vi.fn() },
      { getById: vi.fn() },
      () => now,
    );
    const first = await repository.create(write);
    const second = await repository.create({ ...write, actorId: 'admin-2' });
    expect(first.task.id).toBe(second.task.id);
  });

  it('recovers a concurrent successful conversion with consistent reads', async () => {
    send
      .mockRejectedValueOnce(
        Object.assign(new Error('cancelled'), { name: 'TransactionCanceledException' }),
      )
      .mockResolvedValueOnce({
        Items: [
          {
            PK: 'MEETING#meeting-1',
            SK: 'MINUTES#VERSION#000008',
            entityType: 'MEETING_MINUTES',
            ...minutes,
            actionItems: [{ ...minutes.actionItems[0], taskId }, minutes.actionItems[1]],
            version: 8,
            createdBy: 'admin-1',
            createdAt: now.toISOString(),
          },
        ],
      })
      .mockResolvedValueOnce({
        Item: {
          PK: `TASK#${taskId}`,
          SK: 'META',
          id: taskId,
          groupId: 'group-1',
          title: 'Task xác nhận',
          assigneeId: 'user-1',
          status: TaskStatus.TODO,
          priority: Priority.HIGH,
          sourceMeetingId: 'meeting-1',
          sourceActionItemId: 'action-1',
          createdBy: 'admin-1',
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
          version: 1,
        },
      });

    const result = await new DynamoDbActionItemTaskRepository(
      undefined,
      undefined,
      () => now,
    ).create(write);
    expect(result.task.id).toBe(taskId);
    expect(result.minutes.version).toBe(8);
    expect(send).toHaveBeenCalledTimes(3);
    const minutesQuery = send.mock.calls[1]?.[0] as {
      constructor: { name: string };
      input: { ConsistentRead?: boolean };
    };
    const taskGet = send.mock.calls[2]?.[0] as {
      constructor: { name: string };
      input: { ConsistentRead?: boolean };
    };
    expect(minutesQuery.constructor.name).toBe('QueryCommand');
    expect(minutesQuery.input.ConsistentRead).toBe(true);
    expect(taskGet.constructor.name).toBe('GetCommand');
    expect(taskGet.input.ConsistentRead).toBe(true);
  });

  it('maps an unrelated concurrent Minutes version to 409 only after recovery', async () => {
    const cancelled = Object.assign(new Error('cancelled'), {
      name: 'TransactionCanceledException',
    });
    send.mockRejectedValueOnce(cancelled);
    const latest = { ...minutes, version: 8 };
    const latestReader = { getLatest: vi.fn().mockResolvedValue(latest) };
    await expect(
      new DynamoDbActionItemTaskRepository(latestReader, { getById: vi.fn() }, () => now).create(
        write,
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT', statusCode: 409 });
  });

  it('does not convert unrelated DynamoDB failures or unconfirmed cancellations to conflict', async () => {
    const accessDenied = Object.assign(new Error('denied'), { name: 'AccessDeniedException' });
    send.mockRejectedValueOnce(accessDenied);
    const latestReader = { getLatest: vi.fn() };
    await expect(
      new DynamoDbActionItemTaskRepository(latestReader, { getById: vi.fn() }, () => now).create(
        write,
      ),
    ).rejects.toBe(accessDenied);
    expect(latestReader.getLatest).not.toHaveBeenCalled();

    const cancelled = Object.assign(new Error('cancelled'), {
      name: 'TransactionCanceledException',
    });
    send.mockRejectedValueOnce(cancelled);
    latestReader.getLatest.mockResolvedValue(minutes);
    await expect(
      new DynamoDbActionItemTaskRepository(latestReader, { getById: vi.fn() }, () => now).create(
        write,
      ),
    ).rejects.toBe(cancelled);
  });

  it('treats a recovered broken provenance link as a data-integrity error', async () => {
    send.mockRejectedValueOnce(
      Object.assign(new Error('cancelled'), { name: 'TransactionCanceledException' }),
    );
    const latest = {
      ...minutes,
      actionItems: [{ ...minutes.actionItems[0]!, taskId }, minutes.actionItems[1]!],
      version: 8,
    };
    const wrongTask: Task = {
      id: taskId,
      groupId: 'group-1',
      title: 'Task',
      assigneeId: 'user-1',
      status: TaskStatus.TODO,
      priority: Priority.HIGH,
      sourceMeetingId: 'meeting-other',
      sourceActionItemId: 'action-1',
    };
    await expect(
      new DynamoDbActionItemTaskRepository(
        { getLatest: vi.fn().mockResolvedValue(latest) },
        { getById: vi.fn().mockResolvedValue(wrongTask) },
        () => now,
      ).create(write),
    ).rejects.toThrow('Malformed Action Item task link.');
  });
});
