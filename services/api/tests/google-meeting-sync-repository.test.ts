import { describe, expect, it, vi } from 'vitest';
import { GoogleMeetingSyncStatus, MeetingStatus } from '@campusmeet/shared';
import {
  DynamoDbGoogleMeetingSyncRepository,
  googleSyncItem,
} from '../src/repositories/google-meeting-sync';

const record = {
  meetingId: 'meeting-1',
  groupId: 'group-1',
  organizerId: 'organizer-1',
  provider: 'GOOGLE' as const,
  syncStatus: GoogleMeetingSyncStatus.PENDING,
  syncRevision: 3,
  desiredMeetingVersion: 4,
  desiredMeetingStatus: MeetingStatus.SCHEDULED,
  attemptCount: 0,
  createdAt: '2029-01-01T00:00:00.000Z',
  updatedAt: '2029-01-01T00:00:00.000Z',
};

describe('DynamoDbGoogleMeetingSyncRepository', () => {
  it('maps the accepted PK/SK without OAuth or raw error data', () => {
    expect(googleSyncItem(record)).toEqual(
      expect.objectContaining({
        PK: 'MEETING#meeting-1',
        SK: 'INTEGRATION#GOOGLE',
        entityType: 'GoogleMeetingSyncRecord',
        provider: 'GOOGLE',
        syncRevision: 3,
      }),
    );
  });

  it('protects success writes with the received revision', async () => {
    const send = vi.fn(async () => ({}));
    const repository = new DynamoDbGoogleMeetingSyncRepository({ send } as never, 'meeting-data');
    await expect(
      repository.markSuccess('meeting-1', 3, { googleEventId: 'event-1', attemptCount: 1 }),
    ).resolves.toBe(true);
    const command = send.mock.calls.at(0)?.at(0) as unknown as { input: Record<string, unknown> };
    expect(command.input).toEqual(
      expect.objectContaining({
        TableName: 'meeting-data',
        Key: { PK: 'MEETING#meeting-1', SK: 'INTEGRATION#GOOGLE' },
        ConditionExpression: 'syncRevision=:revision',
        ExpressionAttributeValues: expect.objectContaining({
          ':revision': 3,
          ':eventId': 'event-1',
        }),
      }),
    );
  });

  it('manual retry increments revision and clears retry/failure metadata', async () => {
    const send = vi.fn(async () => ({
      Attributes: { ...googleSyncItem({ ...record, syncRevision: 4 }) },
    }));
    const repository = new DynamoDbGoogleMeetingSyncRepository({ send } as never, 'meeting-data');
    const meeting = { id: 'meeting-1', version: 4, status: MeetingStatus.SCHEDULED } as never;
    await expect(
      repository.manualRetry(meeting, 3, '2029-01-02T00:00:00.000Z'),
    ).resolves.toMatchObject({ syncRevision: 4 });
    const command = send.mock.calls.at(0)?.at(0) as unknown as { input: Record<string, unknown> };
    expect(command.input).toEqual(
      expect.objectContaining({
        ConditionExpression: 'syncRevision=:expected',
        ExpressionAttributeValues: expect.objectContaining({
          ':expected': 3,
          ':next': 4,
          ':zero': 0,
        }),
      }),
    );
  });
});
