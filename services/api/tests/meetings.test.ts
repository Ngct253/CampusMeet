import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IntegrationStatus, MeetingStatus, meetingInputSchema } from '@campusmeet/shared';

const send = vi.hoisted(() => vi.fn());
vi.mock('../src/repositories/client', () => ({
  documentClient: { send },
  tableName: (name: string) => name,
  stringValue: (item: Record<string, unknown>, key: string) =>
    typeof item[key] === 'string' ? item[key] : undefined,
}));

import { DynamoDbMeetingRepository } from '../src/repositories/dynamodb';

describe('meeting core', () => {
  beforeEach(() => send.mockReset());

  it('từ chối khoảng thời gian không hợp lệ', () => {
    const result = meetingInputSchema.safeParse({
      title: 'Họp nhóm',
      attendeeIds: [],
      startsAt: '2026-08-02T10:00:00.000Z',
      endsAt: '2026-08-02T09:00:00.000Z',
    });
    expect(result.success).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it('truy vấn lịch nhóm bằng GSI thay vì quét bảng', async () => {
    send.mockResolvedValueOnce({
      Items: [
        {
          id: 'meeting-1',
          groupId: 'group-1',
          title: 'Họp nhóm',
          organizerId: 'user-1',
          attendeeIds: ['user-1'],
          startsAt: '2026-08-02T10:00:00.000Z',
          endsAt: '2026-08-02T11:00:00.000Z',
          status: MeetingStatus.SCHEDULED,
          integrationStatus: IntegrationStatus.NOT_CONNECTED,
        },
      ],
    });
    const result = await new DynamoDbMeetingRepository().listByGroup('group-1');
    const command = send.mock.calls[0]?.[0] as { input: Record<string, unknown> };
    expect(result).toHaveLength(1);
    expect(command.input).toMatchObject({
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :group AND begins_with(GSI1SK, :meeting)',
    });
  });

  it('luôn thêm người tổ chức vào danh sách tham dự', async () => {
    send.mockResolvedValueOnce({});
    const meeting = await new DynamoDbMeetingRepository().create(
      'group-1',
      'user-1',
      {
        title: 'Họp nhóm',
        attendeeIds: ['user-2'],
        startsAt: '2026-08-02T10:00:00.000Z',
        endsAt: '2026-08-02T11:00:00.000Z',
      },
      'request-1',
    );
    expect(meeting.attendeeIds).toEqual(['user-1', 'user-2']);
    expect(meeting.status).toBe(MeetingStatus.SCHEDULED);
  });
});
