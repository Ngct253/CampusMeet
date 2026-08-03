import { describe, expect, it } from 'vitest';
import { meetingInputSchema } from '@campusmeet/shared';

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
