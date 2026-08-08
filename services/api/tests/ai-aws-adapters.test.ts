import {
  GoogleSyncStatus,
  GroupRole,
  IntegrationStatus,
  MeetingStatus,
  type Meeting,
  type Membership,
} from '@campusmeet/shared';
import type { SFNClient } from '@aws-sdk/client-sfn';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { describe, expect, it, vi } from 'vitest';
import { DynamoAiAccessAdapter, StepFunctionsAIJobOrchestrator } from '../src/ai/aws-adapters';
import type { MeetingAccessBoundary } from '../src/domain/ports';

const membership: Membership = {
  id: 'group-1:user-1',
  groupId: 'group-1',
  userId: 'user-1',
  role: GroupRole.MEMBER,
  active: true,
  joinedAt: '2026-08-02T00:00:00.000Z',
};

const meeting = (id: string, groupId = 'group-1'): Meeting => ({
  id,
  groupId,
  title: 'Planning',
  organizerId: 'organizer-1',
  attendeeIds: [],
  agenda: [],
  startsAt: '2030-01-01T10:00:00.000Z',
  endsAt: '2030-01-01T11:00:00.000Z',
  status: MeetingStatus.CANCELLED,
  googleSyncStatus: GoogleSyncStatus.NOT_REQUESTED,
  integrationStatus: IntegrationStatus.NOT_CONNECTED,
  createdAt: '2026-08-02T00:00:00.000Z',
  createdBy: 'organizer-1',
  updatedAt: '2026-08-02T00:00:00.000Z',
  updatedBy: 'organizer-1',
  version: 2,
});

const boundary = (items: Meeting[]): MeetingAccessBoundary => ({
  getMeeting: vi.fn(async (id) => items.find((item) => item.id === id) ?? null),
  resolveMeetingGroup: vi.fn(async (id) => items.find((item) => item.id === id)?.groupId ?? null),
  canViewMeeting: vi.fn(),
});

describe('M5 AWS access adapter', () => {
  it('delegates member and admin checks to the shared M1 authorization boundary', async () => {
    const authorizeGroup = vi.fn().mockResolvedValue(membership);
    const meetings = boundary([]);
    const adapter = new DynamoAiAccessAdapter(meetings, authorizeGroup);

    await adapter.requireMember('user-1', 'group-1');
    await adapter.requireGroupAdmin('admin-1', 'group-1');

    expect(authorizeGroup).toHaveBeenNthCalledWith(1, 'user-1', 'group-1');
    expect(authorizeGroup).toHaveBeenNthCalledWith(2, 'admin-1', 'group-1', GroupRole.GROUP_ADMIN);
    expect(meetings.getMeeting).not.toHaveBeenCalled();
  });

  it('does not continue when the M1 authorization boundary rejects access', async () => {
    const authorizeGroup = vi.fn().mockRejectedValue(new Error('FORBIDDEN'));
    const meetings = boundary([]);
    const adapter = new DynamoAiAccessAdapter(meetings, authorizeGroup);

    await expect(adapter.requireMember('outsider-1', 'group-1')).rejects.toThrow('FORBIDDEN');
    expect(meetings.getMeeting).not.toHaveBeenCalled();
  });

  it('resolves trusted group and cancelled lifecycle through the M2 boundary', async () => {
    const meetings = boundary([meeting('meeting-1')]);
    const adapter = new DynamoAiAccessAdapter(meetings, vi.fn());

    await expect(adapter.getMeetingGroupId('meeting-1')).resolves.toBe('group-1');
    await expect(adapter.requireMeetingsInGroup(['meeting-1'], 'group-1')).resolves.toBeUndefined();
    expect(meetings.getMeeting).toHaveBeenCalledWith('meeting-1');
  });

  it('rejects selected meetings from another group through the M2 boundary', async () => {
    const meetings = boundary([meeting('meeting-a'), meeting('meeting-b', 'group-2')]);
    const adapter = new DynamoAiAccessAdapter(meetings, vi.fn());

    await expect(
      adapter.requireMeetingsInGroup(['meeting-a', 'meeting-b'], 'group-1'),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('StepFunctionsAIJobOrchestrator idempotency lookup', () => {
  it('strongly recovers the existing job before snapshot regeneration', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({ Item: { aiJobId: 'aij-existing' } })
      .mockResolvedValueOnce({
        Item: {
          aiJobId: 'aij-existing',
          groupId: 'group-1',
          type: 'PROGRESS_ANALYSIS',
          status: 'QUEUED',
          attempt: 0,
          requestId: 'request-original',
          inputTokens: 120,
          outputTokens: 30,
          createdAt: '2026-08-08T10:00:00.000Z',
          updatedAt: '2026-08-08T10:00:00.000Z',
          payload: {
            operation: 'PROGRESS_ANALYSIS',
            actorId: 'admin-1',
            groupId: 'group-1',
            request: { snapshotVersion: 4 },
          },
        },
      });
    const stateMachines = { send: vi.fn() };
    const orchestrator = new StepFunctionsAIJobOrchestrator(
      { send } as unknown as DynamoDBDocumentClient,
      stateMachines as unknown as SFNClient,
      'ai-work',
      'state-machine-arn',
    );

    await expect(
      orchestrator.findExisting({
        actorId: 'admin-1',
        groupId: 'group-1',
        operation: 'PROGRESS_ANALYSIS',
        idempotencyKey: 'idem-1',
      }),
    ).resolves.toMatchObject({
      job: {
        aiJobId: 'aij-existing',
        type: 'PROGRESS_ANALYSIS',
        inputTokens: 120,
        outputTokens: 30,
      },
      payload: {
        operation: 'PROGRESS_ANALYSIS',
        actorId: 'admin-1',
        groupId: 'group-1',
        request: { snapshotVersion: 4 },
      },
    });

    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0]![0].input).toMatchObject({
      TableName: 'ai-work',
      Key: { PK: expect.stringMatching(/^IDEMPOTENCY#AI_REQUEST#/), SK: 'RESULT' },
      ConsistentRead: true,
    });
    expect(send.mock.calls[1]![0].input).toMatchObject({
      Key: { PK: 'AIJOB#aij-existing', SK: 'META' },
      ConsistentRead: true,
    });
    expect(stateMachines.send).not.toHaveBeenCalled();
  });

  it('rejects an idempotency pointer to a job payload in another group', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({ Item: { aiJobId: 'aij-corrupt' } })
      .mockResolvedValueOnce({
        Item: {
          aiJobId: 'aij-corrupt',
          groupId: 'group-2',
          type: 'PROGRESS_ANALYSIS',
          status: 'QUEUED',
          attempt: 0,
          requestId: 'request-corrupt',
          createdAt: '2026-08-08T10:00:00.000Z',
          updatedAt: '2026-08-08T10:00:00.000Z',
          payload: {
            operation: 'PROGRESS_ANALYSIS',
            actorId: 'admin-1',
            groupId: 'group-2',
            request: { snapshotVersion: 4 },
          },
        },
      });
    const orchestrator = new StepFunctionsAIJobOrchestrator(
      { send } as unknown as DynamoDBDocumentClient,
      { send: vi.fn() } as unknown as SFNClient,
      'ai-work',
      'state-machine-arn',
    );

    await expect(
      orchestrator.findExisting({
        actorId: 'admin-1',
        groupId: 'group-1',
        operation: 'PROGRESS_ANALYSIS',
        idempotencyKey: 'idem-corrupt',
      }),
    ).rejects.toThrow('AI_IDEMPOTENCY_DATA_INTEGRITY');
  });
});

describe('StepFunctionsAIJobOrchestrator enqueue recovery', () => {
  const progressPayload = {
    operation: 'PROGRESS_ANALYSIS' as const,
    actorId: 'admin-1',
    groupId: 'group-1',
    request: { snapshotVersion: 4 },
  };

  const recoveredJobItem = (payload: unknown) => ({
    aiJobId: 'aij-existing',
    groupId: 'group-1',
    type: 'PROGRESS_ANALYSIS',
    status: 'QUEUED',
    attempt: 0,
    requestId: 'request-original',
    createdAt: '2026-08-08T10:00:00.000Z',
    updatedAt: '2026-08-08T10:00:00.000Z',
    payload,
  });

  const createRecoveryOrchestrator = (item: Record<string, unknown>) => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error('Transaction cancelled'))
      .mockResolvedValueOnce({ Item: { aiJobId: 'aij-existing' } })
      .mockResolvedValueOnce({ Item: item });
    const stateMachines = { send: vi.fn() };
    const orchestrator = new StepFunctionsAIJobOrchestrator(
      { send } as unknown as DynamoDBDocumentClient,
      stateMachines as unknown as SFNClient,
      'ai-work',
      'state-machine-arn',
    );
    return { orchestrator, send, stateMachines };
  };

  const enqueueProgress = (orchestrator: StepFunctionsAIJobOrchestrator) =>
    orchestrator.enqueue({
      actorId: 'admin-1',
      groupId: 'group-1',
      idempotencyKey: 'idem-1',
      requestId: 'request-racing',
      type: 'PROGRESS_ANALYSIS',
      payload: progressPayload,
    });

  it('persists a canonical payload fingerprint with the idempotency record', async () => {
    const send = vi.fn().mockResolvedValue({});
    const stateMachines = { send: vi.fn().mockResolvedValue({}) };
    const orchestrator = new StepFunctionsAIJobOrchestrator(
      { send } as unknown as DynamoDBDocumentClient,
      stateMachines as unknown as SFNClient,
      'ai-work',
      'state-machine-arn',
    );

    await enqueueProgress(orchestrator);

    expect(send.mock.calls[0]![0].input.TransactItems[1].Put.Item).toMatchObject({
      requestPayloadHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
  });

  it('returns the existing job when concurrent recovery has the same snapshot version', async () => {
    const { orchestrator, stateMachines } = createRecoveryOrchestrator(
      recoveredJobItem(progressPayload),
    );

    await expect(enqueueProgress(orchestrator)).resolves.toMatchObject({
      aiJobId: 'aij-existing',
      groupId: 'group-1',
      type: 'PROGRESS_ANALYSIS',
    });
    expect(stateMachines.send).not.toHaveBeenCalled();
  });

  it('rejects concurrent recovery with a different progress snapshot version', async () => {
    const { orchestrator, stateMachines } = createRecoveryOrchestrator(
      recoveredJobItem({ ...progressPayload, request: { snapshotVersion: 5 } }),
    );

    await expect(enqueueProgress(orchestrator)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(stateMachines.send).not.toHaveBeenCalled();
  });

  it.each([
    ['actor', { ...progressPayload, actorId: 'admin-2' }],
    ['group', { ...progressPayload, groupId: 'group-2' }],
    [
      'operation',
      {
        operation: 'GROUP_SEARCH' as const,
        actorId: 'admin-1',
        groupId: 'group-1',
        request: { question: 'What changed?', scope: 'WHOLE_GROUP' as const },
      },
    ],
  ])('rejects a recovered payload with the wrong %s', async (_field, payload) => {
    const { orchestrator, stateMachines } = createRecoveryOrchestrator(recoveredJobItem(payload));

    await expect(enqueueProgress(orchestrator)).rejects.toThrow('AI_IDEMPOTENCY_DATA_INTEGRITY');
    expect(stateMachines.send).not.toHaveBeenCalled();
  });

  it('preserves recovery for a non-progress operation', async () => {
    const payload = {
      operation: 'GROUP_SEARCH' as const,
      actorId: 'member-1',
      groupId: 'group-1',
      request: { question: 'What changed?', scope: 'WHOLE_GROUP' as const },
    };
    const { orchestrator, stateMachines } = createRecoveryOrchestrator({
      ...recoveredJobItem(payload),
      type: 'GENERATE_ANSWER',
    });

    await expect(
      orchestrator.enqueue({
        actorId: 'member-1',
        groupId: 'group-1',
        idempotencyKey: 'idem-search',
        requestId: 'request-racing',
        type: 'GENERATE_ANSWER',
        payload,
      }),
    ).resolves.toMatchObject({ aiJobId: 'aij-existing', type: 'GENERATE_ANSWER' });
    expect(stateMachines.send).not.toHaveBeenCalled();
  });

  it('rejects a reused key when a non-progress request changes', async () => {
    const existingPayload = {
      operation: 'GROUP_SEARCH' as const,
      actorId: 'member-1',
      groupId: 'group-1',
      request: { question: 'Original question', scope: 'WHOLE_GROUP' as const },
    };
    const { orchestrator, stateMachines } = createRecoveryOrchestrator({
      ...recoveredJobItem(existingPayload),
      type: 'GENERATE_ANSWER',
    });

    await expect(
      orchestrator.enqueue({
        actorId: 'member-1',
        groupId: 'group-1',
        idempotencyKey: 'idem-search',
        requestId: 'request-racing',
        type: 'GENERATE_ANSWER',
        payload: {
          ...existingPayload,
          request: { question: 'Different question', scope: 'WHOLE_GROUP' },
        },
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(stateMachines.send).not.toHaveBeenCalled();
  });
});
