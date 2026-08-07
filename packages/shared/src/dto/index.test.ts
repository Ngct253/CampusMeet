import { describe, expect, it } from 'vitest';
import type { CreateMinutesRequest, MinutesResponse } from './index';
import {
  convertActionItemToTaskInputSchema,
  meetingInputSchema,
  meetingMinutesInputSchema,
  updateMeetingInputSchema,
} from './index';
import { Priority } from '../enums';

const validInput = {
  summary: ' Tóm tắt ',
  discussion: ' Nội dung ',
  decisions: [{ content: ' Quyết định ' }],
  actionItems: [
    {
      id: ' action-1 ',
      content: ' Việc cần làm ',
      assigneeId: ' user-1 ',
      dueAt: '2026-08-10T10:30:00+07:00',
    },
  ],
  expectedVersion: 0,
};

describe('trusted Google sync fields', () => {
  const meeting = {
    title: 'Planning',
    attendeeIds: [],
    agenda: [],
    startsAt: '2029-01-01T10:00:00.000Z',
    endsAt: '2029-01-01T11:00:00.000Z',
  };
  it('does not expose trusted integration fields through create or update parsing', () => {
    expect(
      meetingInputSchema.parse({ ...meeting, googleEventId: 'forged', syncRevision: 99 }),
    ).not.toHaveProperty('googleEventId');
    expect(
      updateMeetingInputSchema.parse({ ...meeting, version: 1, meetUrl: 'https://evil.invalid' }),
    ).not.toHaveProperty('meetUrl');
  });
});

describe('meetingMinutesInputSchema', () => {
  it('keeps deprecated Minutes DTO exports available for existing consumers', () => {
    const legacyRequest: CreateMinutesRequest = {
      meetingId: 'meeting-1',
      summary: 'Legacy summary',
      decisions: [],
      actionItems: [],
    };
    const legacyResponse = { minutes: { id: 'minutes-1' } } as MinutesResponse;
    expect(legacyRequest.meetingId).toBe('meeting-1');
    expect(legacyResponse.minutes.id).toBe('minutes-1');
  });
  it('normalizes a valid request and remains strict at every level', () => {
    expect(meetingMinutesInputSchema.parse(validInput)).toEqual({
      summary: 'Tóm tắt',
      discussion: 'Nội dung',
      decisions: [{ content: 'Quyết định' }],
      actionItems: [
        {
          id: 'action-1',
          content: 'Việc cần làm',
          assigneeId: 'user-1',
          dueAt: '2026-08-10T10:30:00+07:00',
        },
      ],
      expectedVersion: 0,
    });
    expect(
      meetingMinutesInputSchema.safeParse({ ...validInput, createdBy: 'attacker' }).success,
    ).toBe(false);
    expect(
      meetingMinutesInputSchema.safeParse({
        ...validInput,
        decisions: [{ content: 'Decision', id: 'client-id' }],
      }).success,
    ).toBe(false);
    expect(
      meetingMinutesInputSchema.safeParse({
        ...validInput,
        actionItems: [{ content: 'Action', taskId: 'task-1' }],
      }).success,
    ).toBe(false);
  });

  it.each([
    ['empty summary', { ...validInput, summary: ' ' }],
    ['long summary', { ...validInput, summary: 'a'.repeat(2001) }],
    ['long discussion', { ...validInput, discussion: 'a'.repeat(10001) }],
    [
      'too many decisions',
      { ...validInput, decisions: Array.from({ length: 51 }, () => ({ content: 'x' })) },
    ],
    ['empty decision', { ...validInput, decisions: [{ content: ' ' }] }],
    [
      'too many actions',
      { ...validInput, actionItems: Array.from({ length: 101 }, () => ({ content: 'x' })) },
    ],
    ['empty action', { ...validInput, actionItems: [{ content: ' ' }] }],
    ['empty assignee', { ...validInput, actionItems: [{ content: 'x', assigneeId: ' ' }] }],
    ['empty action id', { ...validInput, actionItems: [{ id: ' ', content: 'x' }] }],
    [
      'due date without timezone',
      { ...validInput, actionItems: [{ content: 'x', dueAt: '2026-08-10T10:30:00' }] },
    ],
    ['negative version', { ...validInput, expectedVersion: -1 }],
    ['fractional version', { ...validInput, expectedVersion: 1.5 }],
    ['version above maximum', { ...validInput, expectedVersion: 1000000 }],
  ])('rejects %s', (_label, input) => {
    expect(meetingMinutesInputSchema.safeParse(input).success).toBe(false);
  });

  it.each(['meetingId', 'groupId', 'id', 'version', 'createdAt', 'actorId', 'role'])(
    'rejects server-managed field %s',
    (field) => {
      expect(
        meetingMinutesInputSchema.safeParse({ ...validInput, [field]: 'forged' }).success,
      ).toBe(false);
    },
  );
});

describe('convertActionItemToTaskInputSchema', () => {
  const validInput = {
    expectedMinutesVersion: 1,
    priority: Priority.HIGH,
    assigneeId: ' user-1 ',
    title: ' Công việc ',
  };

  it('normalizes the strict conversion request', () => {
    expect(convertActionItemToTaskInputSchema.parse(validInput)).toEqual({
      expectedMinutesVersion: 1,
      priority: Priority.HIGH,
      assigneeId: 'user-1',
      title: 'Công việc',
    });
  });

  it.each([
    ['zero version', { ...validInput, expectedMinutesVersion: 0 }],
    ['fractional version', { ...validInput, expectedMinutesVersion: 1.5 }],
    ['version above maximum', { ...validInput, expectedMinutesVersion: 1000000 }],
    ['invalid priority', { ...validInput, priority: 'URGENT' }],
    ['empty assignee', { ...validInput, assigneeId: ' ' }],
    ['empty title', { ...validInput, title: ' ' }],
    ['long title', { ...validInput, title: 'x'.repeat(201) }],
  ])('rejects %s', (_label, input) => {
    expect(convertActionItemToTaskInputSchema.safeParse(input).success).toBe(false);
  });

  it.each([
    'meetingId',
    'actionItemId',
    'groupId',
    'taskId',
    'sourceMeetingId',
    'sourceActionItemId',
    'createdBy',
    'status',
    'version',
    'role',
  ])('rejects server-managed or unknown field %s', (field) => {
    expect(
      convertActionItemToTaskInputSchema.safeParse({ ...validInput, [field]: 'forged' }).success,
    ).toBe(false);
  });
});
