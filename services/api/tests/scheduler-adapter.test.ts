import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MeetingStatus, type Meeting } from '@campusmeet/shared';
import {
  EventBridgeSchedulerAdapter,
  GoogleSyncSchedulerAdapter,
} from '../src/integrations/adapters';

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
  googleSyncStatus: 'NOT_REQUESTED',
  integrationStatus: 'NOT_CONNECTED',
  createdAt: '2029-01-01T00:00:00.000Z',
  createdBy: 'admin',
  updatedAt: '2029-01-01T00:00:00.000Z',
  updatedBy: 'admin',
  version: 1,
} as Meeting;

describe('EventBridgeSchedulerAdapter', () => {
  beforeEach(() => {
    process.env.REMINDER_FUNCTION_ARN = 'arn:aws:lambda:ap-southeast-1:123:function:reminder';
    process.env.SCHEDULER_EXECUTION_ROLE_ARN = 'arn:aws:iam::123:role/scheduler';
  });

  afterEach(() => {
    delete process.env.REMINDER_FUNCTION_ARN;
    delete process.env.SCHEDULER_EXECUTION_ROLE_ARN;
  });

  it('creates a one-time schedule fifteen minutes before the meeting', async () => {
    const commands: unknown[] = [];
    const send = vi.fn(async (command: unknown) => {
      commands.push(command);
      return {};
    });
    const adapter = new EventBridgeSchedulerAdapter({ send } as never);

    const result = await adapter.schedule(meeting);

    expect(result.scheduleId).toMatch(/^campusmeet-[a-f0-9]{24}$/);
    const command = commands[0] as {
      constructor: { name: string };
      input: Record<string, unknown>;
    };
    expect(command.constructor.name).toBe('CreateScheduleCommand');
    expect(command.input).toMatchObject({
      Name: result.scheduleId,
      ScheduleExpression: 'at(2030-01-01T09:45:00)',
      ActionAfterCompletion: 'DELETE',
      Target: {
        Arn: process.env.REMINDER_FUNCTION_ARN,
        RoleArn: process.env.SCHEDULER_EXECUTION_ROLE_ARN,
      },
    });
  });

  it('updates the existing schedule when the meeting time changes', async () => {
    const conflict = Object.assign(new Error('already exists'), { name: 'ConflictException' });
    const send = vi.fn().mockRejectedValueOnce(conflict).mockResolvedValueOnce({});
    const adapter = new EventBridgeSchedulerAdapter({ send } as never);

    await adapter.schedule({ ...meeting, version: 2, startsAt: '2030-01-01T12:00:00.000Z' });

    expect(send).toHaveBeenCalledTimes(2);
    const update = send.mock.calls[1]?.[0] as {
      constructor: { name: string };
      input: Record<string, unknown>;
    };
    expect(update.constructor.name).toBe('UpdateScheduleCommand');
    expect(update.input.ScheduleExpression).toBe('at(2030-01-01T11:45:00)');
  });

  it('deletes a schedule and ignores an already deleted schedule', async () => {
    const commands: unknown[] = [];
    const send = vi.fn(async (command: unknown) => {
      commands.push(command);
      return {};
    });
    const adapter = new EventBridgeSchedulerAdapter({ send } as never);
    await adapter.cancel(meeting.id);
    expect((commands[0] as { constructor: { name: string } }).constructor.name).toBe(
      'DeleteScheduleCommand',
    );

    const missing = Object.assign(new Error('not found'), { name: 'ResourceNotFoundException' });
    const idempotent = new EventBridgeSchedulerAdapter({
      send: vi.fn(async () => {
        throw missing;
      }),
    } as never);
    await expect(idempotent.cancel(meeting.id)).resolves.toBeUndefined();
  });
});

describe('GoogleSyncSchedulerAdapter', () => {
  beforeEach(() => {
    process.env.GOOGLE_SYNC_WORKER_ARN = 'arn:aws:lambda:ap-southeast-1:123:function:google-sync';
    process.env.GOOGLE_SYNC_SCHEDULER_ROLE_ARN = 'arn:aws:iam::123:role/google-sync';
  });
  afterEach(() => {
    delete process.env.GOOGLE_SYNC_WORKER_ARN;
    delete process.env.GOOGLE_SYNC_SCHEDULER_ROLE_ARN;
  });
  it('creates an idempotent one-shot worker schedule with identity-only payload and no hidden retry', async () => {
    const send = vi.fn(async () => ({}));
    const adapter = new GoogleSyncSchedulerAdapter({ send } as never);
    await adapter.schedule({
      meetingId: 'meeting-1',
      syncRevision: 7,
      attemptCount: 2,
      runAt: '2029-01-01T00:05:00.000Z',
    });
    const command = send.mock.calls.at(0)?.at(0) as unknown as {
      input: {
        Target: { Input: string };
      } & Record<string, unknown>;
    };
    expect(command.input).toMatchObject({
      Name: expect.stringMatching(/^campusmeet-google-[a-f0-9]{20}-r7-a2$/),
      ScheduleExpression: 'at(2029-01-01T00:05:00)',
      FlexibleTimeWindow: { Mode: 'OFF' },
      ActionAfterCompletion: 'DELETE',
      Target: { RetryPolicy: { MaximumRetryAttempts: 0 } },
    });
    expect(JSON.parse(command.input.Target.Input)).toEqual({
      meetingId: 'meeting-1',
      syncRevision: 7,
    });
  });
});
