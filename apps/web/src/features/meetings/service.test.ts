import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UpdateMeetingMinutesRequest } from '@campusmeet/shared';

const request = vi.hoisted(() => vi.fn());
vi.mock('../../lib/api-client', () => ({ apiClient: { request } }));

import {
  getAllMeetings,
  getMeetingMinutes,
  getMeetings,
  retryGoogleMeetingSync,
  updateMeetingMinutes,
} from './service';

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
  it('uses the public page contract and loads every page for full-list consumers', async () => {
    request
      .mockResolvedValueOnce({ success: true, data: { items: [{ id: 'm1' }], nextCursor: 'next' } })
      .mockResolvedValueOnce({ success: true, data: { items: [{ id: 'm2' }] } });
    await expect(getAllMeetings('group/one')).resolves.toEqual([{ id: 'm1' }, { id: 'm2' }]);
    expect(request).toHaveBeenNthCalledWith(1, '/groups/group/one/meetings?limit=100');
    expect(request).toHaveBeenNthCalledWith(2, '/groups/group/one/meetings?limit=100&cursor=next');

    request.mockResolvedValueOnce({ success: true, data: { items: [] } });
    await getMeetings('group/one', { limit: 20, cursor: 'opaque' });
    expect(request).toHaveBeenLastCalledWith('/groups/group/one/meetings?limit=20&cursor=opaque');
  });
});

it('creates a manual Google retry intent without client-controlled sync fields', async () => {
  request.mockResolvedValue({
    success: true,
    data: { provider: 'GOOGLE', status: 'PENDING' },
    requestId: 'request-1',
  });
  await expect(retryGoogleMeetingSync('meeting/one')).resolves.toEqual({
    provider: 'GOOGLE',
    status: 'PENDING',
  });
  expect(request).toHaveBeenCalledWith('/meetings/meeting%2Fone/google-sync/retry', {
    method: 'POST',
    body: '{}',
  });
});
