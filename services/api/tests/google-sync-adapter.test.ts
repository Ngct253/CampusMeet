import { describe, expect, it, vi } from 'vitest';
import {
  GoogleSyncStatus,
  IntegrationStatus,
  MeetingStatus,
  type GoogleMeetingSyncRecord,
  type Meeting,
} from '@campusmeet/shared';
import { GoogleMeetingSyncAdapter } from '../src/integrations/adapters';

const meeting = {
  id: 'meeting-1',
  groupId: 'group-1',
  title: 'Planning',
  organizerId: 'admin',
  attendeeIds: ['admin'],
  agenda: [],
  startsAt: '2030-01-01T10:00:00.000Z',
  endsAt: '2030-01-01T11:00:00.000Z',
  status: MeetingStatus.SCHEDULED,
  googleSyncStatus: GoogleSyncStatus.PENDING,
  integrationStatus: IntegrationStatus.PENDING,
  createdAt: '2029-01-01T00:00:00.000Z',
  createdBy: 'admin',
  updatedAt: '2029-01-01T00:00:00.000Z',
  updatedBy: 'admin',
  version: 1,
} as Meeting;
const sync = {
  meetingId: meeting.id,
  googleEventId: 'event-1',
} as GoogleMeetingSyncRecord;
const integrations = {
  getTokens: vi.fn(async () => ({
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    expiresAt: '2031-01-01T00:00:00.000Z',
    scope: 'calendar',
  })),
  saveTokens: vi.fn(async () => undefined),
};
const identities = {
  getProfiles: vi.fn(async () => new Map([['admin', { id: 'admin', email: 'admin@example.com' }]])),
};

describe('GoogleMeetingSyncAdapter', () => {
  it('uses a deterministic event id and updates instead of duplicating on conflict', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: {} }), { status: 409 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ id: 'stable-event', hangoutLink: 'https://meet.google.com/a' }),
          { status: 200 },
        ),
      );
    const adapter = new GoogleMeetingSyncAdapter(
      integrations as never,
      {} as never,
      fetcher,
      () => new Date('2029-01-01T00:00:00.000Z'),
      identities as never,
    );

    await expect(adapter.reconcile(meeting, sync)).resolves.toMatchObject({
      eventId: 'stable-event',
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0]?.[1]?.method).toBe('POST');
    expect(fetcher.mock.calls[1]?.[1]?.method).toBe('PUT');
    const firstBody = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)) as {
      id: string;
      extendedProperties: { private: { campusMeetMeetingId: string } };
    };
    expect(firstBody.id).toMatch(/^[a-f0-9]{32}$/);
    expect(firstBody.extendedProperties.private.campusMeetMeetingId).toBe(meeting.id);
  });

  it('treats deletion of an absent Google event as converged', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 404 }));
    const adapter = new GoogleMeetingSyncAdapter(
      integrations as never,
      {} as never,
      fetcher,
      () => new Date('2029-01-01T00:00:00.000Z'),
      identities as never,
    );
    await expect(
      adapter.reconcile({ ...meeting, status: MeetingStatus.CANCELLED }, sync),
    ).resolves.toEqual({ eventId: 'event-1' });
  });

  it('classifies rate limiting without persisting a raw Google response', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ error: { errors: [{ reason: 'rateLimitExceeded' }] } }), {
        status: 403,
      }),
    );
    const adapter = new GoogleMeetingSyncAdapter(
      integrations as never,
      {} as never,
      fetcher,
      () => new Date('2029-01-01T00:00:00.000Z'),
      identities as never,
    );
    await expect(adapter.reconcile(meeting, sync)).rejects.toMatchObject({
      failureClass: 'RETRYABLE',
      safeCode: 'GOOGLE_TEMPORARY_FAILURE',
    });
  });
});
