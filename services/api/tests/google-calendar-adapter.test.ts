import { describe, expect, it, vi } from 'vitest';
import {
  GoogleSyncStatus,
  IntegrationStatus,
  MeetingStatus,
  type Meeting,
} from '@campusmeet/shared';
import { GoogleCalendarAdapter } from '../src/integrations/adapters';

const meeting: Meeting = {
  id: 'meeting-1',
  groupId: 'group-1',
  organizerId: 'organizer-1',
  title: 'Planning',
  attendeeIds: ['organizer-1'],
  agenda: [],
  startsAt: '2029-01-01T10:00:00.000Z',
  endsAt: '2029-01-01T11:00:00.000Z',
  status: MeetingStatus.SCHEDULED,
  googleSyncStatus: GoogleSyncStatus.NOT_REQUESTED,
  integrationStatus: IntegrationStatus.NOT_CONNECTED,
  createdAt: '2029-01-01T00:00:00.000Z',
  createdBy: 'organizer-1',
  updatedAt: '2029-01-01T00:00:00.000Z',
  updatedBy: 'organizer-1',
  version: 1,
};
const response = (status: number, body: object = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const adapter = (fetcher: typeof fetch) =>
  new GoogleCalendarAdapter(
    {
      getTokens: vi.fn(async () => ({
        accessToken: 'redacted',
        refreshToken: 'redacted',
        expiresAt: '2030-01-01T00:00:00.000Z',
      })),
      saveTokens: vi.fn(),
    } as never,
    { get: vi.fn() },
    fetcher,
    () => new Date('2029-01-01T00:00:00.000Z'),
  );

describe('GoogleCalendarAdapter reconciliation', () => {
  it('uses one deterministic Google event id and stable conference request identity', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(404))
      .mockResolvedValueOnce(
        response(200, { id: 'event', hangoutLink: 'https://meet.google.com/abc-defg-hij' }),
      );
    const result = await adapter(fetcher).ensureScheduledMeeting(meeting, {});
    const inserted = JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body));
    expect(inserted.id).toMatch(/^cm[0-9a-f]{64}$/);
    expect(inserted.conferenceData.createRequest.requestId).toMatch(/^cm-[0-9a-f]{32}$/);
    expect(result).toEqual({
      eventId: inserted.id,
      meetUrl: 'https://meet.google.com/abc-defg-hij',
    });
  });

  it('updates an existing deterministic event and reconciles insert conflict without a second id', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(404))
      .mockResolvedValueOnce(response(409))
      .mockResolvedValueOnce(response(200, { id: 'existing' }));
    const result = await adapter(fetcher).ensureScheduledMeeting(meeting, {});
    const inserted = JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body));
    expect(fetcher.mock.calls[2]?.[0]).toContain(inserted.id);
    expect(fetcher.mock.calls[2]?.[1]?.method).toBe('PATCH');
    expect(result.eventId).toBe(inserted.id);
  });

  it('treats an already-missing cancellation as satisfied', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(404));
    await expect(adapter(fetcher).ensureCancelledMeeting(meeting)).resolves.toBeUndefined();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[1]?.method).toBe('DELETE');
  });
});
