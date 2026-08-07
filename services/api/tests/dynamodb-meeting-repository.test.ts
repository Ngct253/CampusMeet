import { describe, expect, it } from 'vitest';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import {
  GoogleSyncStatus,
  GoogleMeetingSyncStatus,
  IntegrationStatus,
  MeetingStatus,
  type Meeting,
} from '@campusmeet/shared';
import { DynamoDbMeetingRepository } from '../src/repositories/dynamodb';

const meeting: Meeting = {
  id: 'm1',
  groupId: 'g1',
  title: 'Plan',
  organizerId: 'u1',
  attendeeIds: ['u1', 'u2'],
  agenda: [
    { id: 'a1', order: 1, title: 'Second' },
    { id: 'a0', order: 0, title: 'First' },
  ],
  startsAt: '2030-01-01T10:00:00.000Z',
  endsAt: '2030-01-01T11:00:00.000Z',
  status: MeetingStatus.SCHEDULED,
  googleSyncStatus: GoogleSyncStatus.NOT_REQUESTED,
  integrationStatus: IntegrationStatus.NOT_CONNECTED,
  createdAt: '2029-01-01T00:00:00.000Z',
  createdBy: 'u1',
  updatedAt: '2029-01-01T00:00:00.000Z',
  updatedBy: 'u1',
  version: 1,
};
type Command = { input: Record<string, unknown> };
describe('DynamoDbMeetingRepository', () => {
  it('create dùng transaction và map attendee/agenda đúng sort key', async () => {
    let captured: Command | undefined;
    const db = {
      send: (command: Command) => {
        captured = command;
        return Promise.resolve({});
      },
    } as unknown as DynamoDBDocumentClient;
    await new DynamoDbMeetingRepository(db, 'meeting-data').create(meeting, {
      meetingId: 'm1',
      groupId: 'g1',
      organizerId: 'u1',
      provider: 'GOOGLE',
      syncStatus: GoogleMeetingSyncStatus.PENDING,
      syncRevision: 1,
      desiredMeetingVersion: 1,
      desiredMeetingStatus: MeetingStatus.SCHEDULED,
      attemptCount: 0,
      createdAt: meeting.createdAt,
      updatedAt: meeting.updatedAt,
    });
    expect(captured?.constructor.name).not.toBe('ScanCommand');
    const tx = captured?.input.TransactItems as Array<{ Put: { Item: Record<string, unknown> } }>;
    expect(tx[0]?.Put.Item).toMatchObject({
      PK: 'MEETING#m1',
      SK: 'META',
      GSI1PK: 'GROUP#g1',
      GSI2PK: 'USER#u1',
    });
    expect(tx.map((x) => x.Put.Item.SK)).toContain('ATTENDEE#u2');
    expect(tx.map((x) => x.Put.Item.SK)).toContain('AGENDA#000000#a0');
    expect(tx.map((x) => x.Put.Item.SK)).toContain('INTEGRATION#GOOGLE');
  });
  it('list query GSI1 với limit/cursor, không Scan', async () => {
    let captured: Command | undefined;
    const db = {
      send: (command: Command) => {
        captured = command;
        return Promise.resolve({
          Items: [{ ...meeting, startAt: meeting.startsAt, endAt: meeting.endsAt }],
          LastEvaluatedKey: {
            PK: 'MEETING#m1',
            SK: 'META',
            GSI1PK: 'GROUP#g1',
            GSI1SK: 'MEETING#' + meeting.startsAt + '#' + meeting.id,
          },
        });
      },
    } as unknown as DynamoDBDocumentClient;
    const page = await new DynamoDbMeetingRepository(db, 'meeting-data').listByGroup('g1', 10);
    expect(captured?.constructor.name).toBe('QueryCommand');
    expect(captured?.input).toMatchObject({
      TableName: 'meeting-data',
      IndexName: 'GSI1',
      Limit: 10,
      ScanIndexForward: true,
    });
    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).toBeTruthy();
  });
  it('conditional conflict được map 409', async () => {
    const conflict = Object.assign(new Error('conflict'), { name: 'TransactionCanceledException' });
    const db = { send: () => Promise.reject(conflict) } as unknown as DynamoDBDocumentClient;
    await expect(
      new DynamoDbMeetingRepository(db, 'meeting-data').create(meeting),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });
  it('update dùng optimistic version trong transaction', async () => {
    const commands: Command[] = [];
    const db = {
      send: (command: Command) => {
        commands.push(command);
        return Promise.resolve(commands.length === 1 ? { Items: [] } : {});
      },
    } as unknown as DynamoDBDocumentClient;
    await new DynamoDbMeetingRepository(db, 'meeting-data').update(
      { ...meeting, title: 'Updated', version: 2 },
      1,
    );
    const transaction = commands[1]?.input.TransactItems as Array<{
      Put?: { ConditionExpression?: string; ExpressionAttributeValues?: Record<string, unknown> };
    }>;
    expect(transaction[0]?.Put).toMatchObject({
      ConditionExpression: '#version = :version',
      ExpressionAttributeValues: { ':version': 1 },
    });
  });
  it('cancel lần hai không update, không tăng version và không hard-delete', async () => {
    const commands: Command[] = [];
    const cancelled = {
      ...meeting,
      status: MeetingStatus.CANCELLED,
      cancelledAt: '2029-01-02T00:00:00.000Z',
      cancelledBy: 'u1',
      version: 2,
      SK: 'META',
      PK: 'MEETING#m1',
    };
    const db = {
      send: (command: Command) => {
        commands.push(command);
        return Promise.resolve({ Items: [cancelled] });
      },
    } as unknown as DynamoDBDocumentClient;
    const result = await new DynamoDbMeetingRepository(db, 'meeting-data').cancel(
      'm1',
      'u1',
      'retry',
      1,
    );
    expect(result.version).toBe(2);
    expect(commands).toHaveLength(1);
    expect(commands[0]?.constructor.name).toBe('QueryCommand');
  });
});
