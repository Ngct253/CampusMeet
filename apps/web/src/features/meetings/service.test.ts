import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UpdateMeetingMinutesRequest } from '@campusmeet/shared';

const request = vi.hoisted(() => vi.fn());
vi.mock('../../lib/api-client', () => ({ apiClient: { request } }));

import { getMeetingMinutes, updateMeetingMinutes } from './service';

describe('meeting minutes service', () => {
  beforeEach(() => request.mockReset());

  it('loads Minutes from the encoded nested meeting path', async () => {
    const minutes = { meetingId: 'meeting/one', version: 1 };
    request.mockResolvedValue({ success: true, data: minutes, requestId: 'request-1' });
    await expect(getMeetingMinutes('meeting/one')).resolves.toBe(minutes);
    expect(request).toHaveBeenCalledWith('/meetings/meeting%2Fone/minutes');
  });

  it('puts only the shared request body without server-managed metadata', async () => {
    const input: UpdateMeetingMinutesRequest = {
      summary: 'Tóm tắt',
      discussion: '',
      decisions: [{ content: 'Quyết định' }],
      actionItems: [{ content: 'Hành động', assigneeId: 'user-1' }],
      expectedVersion: 2,
    };
    request.mockResolvedValue({ success: true, data: { version: 3 }, requestId: 'request-1' });
    await updateMeetingMinutes('meeting/one', input);
    expect(request).toHaveBeenCalledWith('/meetings/meeting%2Fone/minutes', {
      method: 'PUT',
      body: JSON.stringify(input),
    });
    const body = JSON.parse(request.mock.calls[0]?.[1]?.body as string) as Record<string, unknown>;
    expect(body).not.toHaveProperty('meetingId');
    expect(body).not.toHaveProperty('groupId');
    expect(body).not.toHaveProperty('createdBy');
    expect(body).not.toHaveProperty('version');
  });
});
