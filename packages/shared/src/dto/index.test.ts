import { describe, expect, it } from 'vitest';
import type { CreateMinutesRequest, MinutesResponse } from './index';
import { meetingMinutesInputSchema } from './index';

const validInput = {
  summary: ' Tóm tắt ',
  discussion: ' Nội dung ',
  decisions: [{ content: ' Quyết định ' }],
  actionItems: [{ content: ' Việc cần làm ', assigneeId: ' user-1 ' }],
  expectedVersion: 0,
};

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
      actionItems: [{ content: 'Việc cần làm', assigneeId: 'user-1' }],
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
