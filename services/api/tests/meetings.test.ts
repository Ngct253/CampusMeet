import { describe, expect, it } from 'vitest';
import { meetingInputSchema, updateMeetingInputSchema } from '@campusmeet/shared';

describe('meeting contract validation', () => {
  it('từ chối khoảng thời gian không hợp lệ trước khi persistence', () => {
    const result = meetingInputSchema.safeParse({
      title: 'Họp nhóm',
      attendeeIds: [],
      startsAt: '2026-08-02T10:00:00.000Z',
      endsAt: '2026-08-02T09:00:00.000Z',
    });
    expect(result.success).toBe(false);
  });
});

it('giữ version hợp lệ trong PATCH contract và từ chối version malformed', () => {
  expect(updateMeetingInputSchema.parse({ title: 'Cập nhật', version: 3 })).toEqual({
    title: 'Cập nhật',
    version: 3,
  });
  expect(updateMeetingInputSchema.safeParse({ version: 0 }).success).toBe(false);
  expect(updateMeetingInputSchema.safeParse({ version: '3' }).success).toBe(false);
  expect(updateMeetingInputSchema.safeParse({ title: 'Missing version' }).success).toBe(false);
});
