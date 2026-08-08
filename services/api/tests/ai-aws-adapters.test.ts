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
      job: { aiJobId: 'aij-existing', type: 'PROGRESS_ANALYSIS' },
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

  it('persists the initial execution identity before start and confirms it after public status may advance', async () => {
    const send = vi.fn().mockResolvedValueOnce({}).mockResolvedValueOnce({});
    const start = vi.fn().mockResolvedValueOnce({});
    const orchestrator = new StepFunctionsAIJobOrchestrator(
      { send } as unknown as DynamoDBDocumentClient,
      { send: start } as unknown as SFNClient,
      'ai-work',
      'state-machine-arn',
    );

    await enqueueProgress(orchestrator);

    const initialJob = send.mock.calls[0]![0].input.TransactItems[0].Put.Item;
    expect(initialJob).toMatchObject({
      orchestrationState: 'STARTING',
      executionName: expect.any(String),
      orchestrationAttempt: 1,
    });
    expect(start.mock.calls[0]![0].input.name).toBe(initialJob.executionName);
    expect(send.mock.calls[1]![0].input).toMatchObject({
      UpdateExpression: 'SET orchestrationState = :started, orchestrationStartedAt = :now',
      ConditionExpression: 'orchestrationState = :starting AND executionName = :executionName',
      ExpressionAttributeValues: {
        ':starting': 'STARTING',
        ':executionName': initialJob.executionName,
      },
    });
    expect(send.mock.calls[1]![0].input.UpdateExpression).not.toContain('errorCode');
    expect(send.mock.calls[1]![0].input.ConditionExpression).not.toContain('status');
  });

  it('does not mark a demonstrably progressed job failed after an ambiguous start error', async () => {
    const claimLost = Object.assign(new Error('status advanced'), {
      name: 'ConditionalCheckFailedException',
    });
    let persistedJob: Record<string, unknown> | undefined;
    const send = vi
      .fn()
      .mockImplementationOnce(async (command) => {
        persistedJob = command.input.TransactItems[0].Put.Item;
        return {};
      })
      .mockRejectedValueOnce(claimLost)
      .mockImplementationOnce(async () => ({
        Item: { ...persistedJob, status: 'PROCESSING' },
      }));
    const startError = Object.assign(new Error('timeout after dispatch'), { name: 'TimeoutError' });
    const orchestrator = new StepFunctionsAIJobOrchestrator(
      { send } as unknown as DynamoDBDocumentClient,
      { send: vi.fn().mockRejectedValueOnce(startError) } as unknown as SFNClient,
      'ai-work',
      'state-machine-arn',
    );

    await expect(enqueueProgress(orchestrator)).resolves.toMatchObject({ status: 'PROCESSING' });

    expect(send.mock.calls[1]![0].input).toMatchObject({
      ConditionExpression:
        '#status = :queued AND orchestrationState = :starting AND executionName = :executionName',
    });
    expect(send.mock.calls).toHaveLength(3);
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

    await expect(enqueueProgress(orchestrator)).rejects.toThrow('AI_IDEMPOTENCY_DATA_INTEGRITY');
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
});

describe('StepFunctionsAIJobOrchestrator ensureStarted', () => {
  const payload = {
    operation: 'INGEST_SOURCE' as const,
    actorId: 'admin-1',
    groupId: 'group-1',
    meetingId: 'meeting-1',
    sourceId: 'source-1',
    sourceType: 'TRANSCRIPT' as const,
    sourceVersion: 1,
    approved: true as const,
    inputObjectKey: 'uploads/group-1/meeting-1/source.txt',
    contentType: 'text/plain' as const,
  };
  const item = (override: Record<string, unknown> = {}) => ({
    PK: 'AIJOB#aij-existing',
    SK: 'META',
    entityType: 'AIJob',
    aiJobId: 'aij-existing',
    groupId: 'group-1',
    meetingId: 'meeting-1',
    type: 'INGEST_SOURCE',
    status: 'QUEUED',
    attempt: 0,
    requestId: 'request-1',
    provider: 'BEDROCK',
    createdAt: '2026-08-08T10:00:00.000Z',
    updatedAt: '2026-08-08T10:00:00.000Z',
    payload,
    ...override,
  });
  const create = (send: ReturnType<typeof vi.fn>, start = vi.fn().mockResolvedValue({})) => ({
    orchestrator: new StepFunctionsAIJobOrchestrator(
      { send } as unknown as DynamoDBDocumentClient,
      { send: start } as unknown as SFNClient,
      'ai-work',
      'state-machine-arn',
    ),
    start,
  });

  it('starts an existing job without creating an AIJob or idempotency record', async () => {
    const claimed = item({
      orchestrationState: 'STARTING',
      executionName: 'aij-existing-attempt-one',
      orchestrationAttempt: 1,
    });
    const send = vi
      .fn()
      .mockResolvedValueOnce({ Item: item() })
      .mockResolvedValueOnce({ Attributes: claimed })
      .mockResolvedValueOnce({});
    const { orchestrator, start } = create(send);
    await expect(orchestrator.ensureStarted('aij-existing')).resolves.toMatchObject({
      aiJobId: 'aij-existing',
    });
    expect(start).toHaveBeenCalledTimes(1);
    expect(start.mock.calls[0]![0].input).toMatchObject({
      name: 'aij-existing-attempt-one',
      input: JSON.stringify({ aiJobId: 'aij-existing' }),
    });
    expect(send.mock.calls.map(([command]) => command.constructor.name)).toEqual([
      'GetCommand',
      'UpdateCommand',
      'UpdateCommand',
    ]);
  });

  it('heals ORCHESTRATION_START_FAILED using the same logical job and a new attempt name', async () => {
    const failed = item({ status: 'FAILED', errorCode: 'ORCHESTRATION_START_FAILED' });
    const claimed = item({
      orchestrationState: 'STARTING',
      executionName: 'aij-existing-attempt-recovery',
      orchestrationAttempt: 2,
    });
    const send = vi
      .fn()
      .mockResolvedValueOnce({ Item: failed })
      .mockResolvedValueOnce({ Attributes: claimed })
      .mockResolvedValueOnce({});
    const { orchestrator, start } = create(send);
    await expect(orchestrator.ensureStarted('aij-existing')).resolves.toMatchObject({
      aiJobId: 'aij-existing',
    });
    expect(start.mock.calls[0]![0].input.name).toBe('aij-existing-attempt-recovery');
    expect(send.mock.calls[1]![0].input.UpdateExpression).toContain('REMOVE errorCode');
  });

  it.each([
    ['a successful retry', undefined],
    [
      'ExecutionAlreadyExists reconciliation',
      Object.assign(new Error('execution exists'), { name: 'ExecutionAlreadyExists' }),
    ],
  ])(
    'reconciles a modern failed-start record through %s without changing its attempt identity',
    async (_scenario, startResult) => {
      const failed = item({
        status: 'FAILED',
        errorCode: 'ORCHESTRATION_START_FAILED',
        orchestrationState: 'STARTING',
        executionName: 'persisted-attempt',
        orchestrationAttempt: 3,
      });
      const send = vi.fn().mockResolvedValueOnce({ Item: failed }).mockResolvedValueOnce({});
      const start = startResult
        ? vi.fn().mockRejectedValueOnce(startResult)
        : vi.fn().mockResolvedValueOnce({});
      const { orchestrator } = create(send, start);

      await expect(orchestrator.ensureStarted('aij-existing')).resolves.toMatchObject({
        aiJobId: 'aij-existing',
        status: 'QUEUED',
      });

      expect(start.mock.calls[0]![0].input).toMatchObject({
        name: 'persisted-attempt',
        input: JSON.stringify({ aiJobId: 'aij-existing' }),
      });
      expect(send.mock.calls.map(([command]) => command.constructor.name)).toEqual([
        'GetCommand',
        'UpdateCommand',
      ]);
      expect(send.mock.calls[1]![0].input).toMatchObject({
        UpdateExpression: expect.stringContaining('#status = :queued'),
        ConditionExpression:
          'orchestrationState = :starting AND executionName = :executionName AND #status = :failed AND errorCode = :startFailed',
        ExpressionAttributeValues: {
          ':executionName': 'persisted-attempt',
          ':failed': 'FAILED',
          ':startFailed': 'ORCHESTRATION_START_FAILED',
          ':queued': 'QUEUED',
        },
      });
      expect(send.mock.calls[1]![0].input.UpdateExpression).toContain(
        'orchestrationState = :started',
      );
      expect(send.mock.calls[1]![0].input.UpdateExpression).toContain('REMOVE errorCode');
      expect(send.mock.calls[1]![0].input.UpdateExpression).not.toContain('orchestrationAttempt');
    },
  );

  it.each(['PROCESSING', 'COMPLETED', 'CANCELLED'] as const)(
    'preserves worker-advanced %s while reconciling a modern failed-start attempt',
    async (status) => {
      const failed = item({
        status: 'FAILED',
        errorCode: 'ORCHESTRATION_START_FAILED',
        orchestrationState: 'STARTING',
        executionName: 'persisted-attempt',
        orchestrationAttempt: 3,
      });
      const advanced = item({
        status,
        orchestrationState: 'STARTING',
        executionName: 'persisted-attempt',
        orchestrationAttempt: 3,
      });
      const conflict = Object.assign(new Error('worker advanced'), {
        name: 'ConditionalCheckFailedException',
      });
      const send = vi
        .fn()
        .mockResolvedValueOnce({ Item: failed })
        .mockRejectedValueOnce(conflict)
        .mockResolvedValueOnce({ Item: advanced })
        .mockResolvedValueOnce({});
      const { orchestrator, start } = create(send);

      await expect(orchestrator.ensureStarted('aij-existing')).resolves.toMatchObject({ status });

      expect(start.mock.calls[0]![0].input.name).toBe('persisted-attempt');
      expect(send.mock.calls[3]![0].input).toMatchObject({
        UpdateExpression: 'SET orchestrationState = :started, orchestrationStartedAt = :now',
        ConditionExpression:
          'orchestrationState = :starting AND executionName = :executionName AND #status IN (:processing, :completed, :cancelled)',
      });
      expect(send.mock.calls[3]![0].input.UpdateExpression).not.toContain('#status');
    },
  );

  it.each(['PROCESSING', 'COMPLETED'] as const)(
    'does not duplicate a %s job execution',
    async (status) => {
      const send = vi.fn().mockResolvedValueOnce({ Item: item({ status }) });
      const { orchestrator, start } = create(send);
      await expect(orchestrator.ensureStarted('aij-existing')).resolves.toMatchObject({ status });
      expect(start).not.toHaveBeenCalled();
      expect(send).toHaveBeenCalledTimes(1);
    },
  );

  it('is idempotent after orchestration is marked STARTED', async () => {
    const send = vi.fn().mockResolvedValueOnce({
      Item: item({ orchestrationState: 'STARTED', executionName: 'attempt-one' }),
    });
    const { orchestrator, start } = create(send);
    await orchestrator.ensureStarted('aij-existing');
    expect(start).not.toHaveBeenCalled();
  });

  it('retries an ambiguous start with the exact persisted name and input', async () => {
    const ambiguous = Object.assign(new Error('timeout'), { name: 'TimeoutError' });
    const claimed = item({
      orchestrationState: 'STARTING',
      executionName: 'stable-attempt',
      orchestrationAttempt: 1,
    });
    const send = vi
      .fn()
      .mockResolvedValueOnce({ Item: item() })
      .mockResolvedValueOnce({ Attributes: claimed });
    const start = vi.fn().mockRejectedValueOnce(ambiguous);
    const { orchestrator } = create(send, start);
    await expect(orchestrator.ensureStarted('aij-existing')).rejects.toBe(ambiguous);
    expect(send).toHaveBeenCalledTimes(2);

    send.mockResolvedValueOnce({ Item: claimed }).mockResolvedValueOnce({});
    start.mockRejectedValueOnce(
      Object.assign(new Error('execution exists'), { name: 'ExecutionAlreadyExists' }),
    );
    await orchestrator.ensureStarted('aij-existing');
    expect(start).toHaveBeenCalledTimes(2);
    expect(start.mock.calls[0]![0].input).toEqual(start.mock.calls[1]![0].input);
  });

  it('reconciles ExecutionAlreadyExists for the same persisted attempt without another job', async () => {
    const alreadyExists = Object.assign(new Error('execution exists'), {
      name: 'ExecutionAlreadyExists',
    });
    const claimed = item({
      orchestrationState: 'STARTING',
      executionName: 'stable-attempt',
      orchestrationAttempt: 1,
    });
    const send = vi.fn().mockResolvedValueOnce({ Item: claimed }).mockResolvedValueOnce({});
    const start = vi.fn().mockRejectedValueOnce(alreadyExists);
    const { orchestrator } = create(send, start);

    await expect(orchestrator.ensureStarted('aij-existing')).resolves.toMatchObject({
      aiJobId: 'aij-existing',
    });

    expect(start).toHaveBeenCalledTimes(1);
    expect(start.mock.calls[0]![0].input).toMatchObject({
      name: 'stable-attempt',
      input: JSON.stringify({ aiJobId: 'aij-existing' }),
    });
    expect(send.mock.calls.map(([command]) => command.constructor.name)).toEqual([
      'GetCommand',
      'UpdateCommand',
    ]);
    expect(send.mock.calls[1]![0].input).toMatchObject({
      ConditionExpression: 'orchestrationState = :starting AND executionName = :executionName',
      ExpressionAttributeValues: { ':executionName': 'stable-attempt' },
    });
  });

  it('reuses the winning execution identity when a concurrent legacy claim loses', async () => {
    const claimLost = Object.assign(new Error('claim lost'), {
      name: 'ConditionalCheckFailedException',
    });
    const winner = item({
      orchestrationState: 'STARTING',
      executionName: 'caller-a-attempt',
      orchestrationAttempt: 1,
    });
    const send = vi
      .fn()
      .mockResolvedValueOnce({ Item: item() })
      .mockRejectedValueOnce(claimLost)
      .mockResolvedValueOnce({ Item: winner })
      .mockResolvedValueOnce({});
    const { orchestrator, start } = create(send);

    await orchestrator.ensureStarted('aij-existing');

    expect(start).toHaveBeenCalledTimes(1);
    expect(start.mock.calls[0]![0].input.name).toBe('caller-a-attempt');
    expect(send.mock.calls[3]![0].input.ExpressionAttributeValues[':executionName']).toBe(
      'caller-a-attempt',
    );
    expect(send.mock.calls.map(([command]) => command.constructor.name)).toEqual([
      'GetCommand',
      'UpdateCommand',
      'GetCommand',
      'UpdateCommand',
    ]);
  });

  it('returns 404 for a missing job and integrity failure for malformed persistence', async () => {
    const missing = create(vi.fn().mockResolvedValueOnce({})).orchestrator;
    await expect(missing.ensureStarted('aij-existing')).rejects.toMatchObject({ statusCode: 404 });
    const malformed = create(
      vi.fn().mockResolvedValueOnce({ Item: item({ entityType: 'Wrong' }) }),
    ).orchestrator;
    await expect(malformed.ensureStarted('aij-existing')).rejects.toThrow('AI_JOB_DATA_INTEGRITY');
  });

  it('rethrows unrelated DynamoDB and Step Functions failures unchanged', async () => {
    const databaseFailure = Object.assign(new Error('db denied'), {
      name: 'AccessDeniedException',
    });
    await expect(
      create(vi.fn().mockRejectedValueOnce(databaseFailure)).orchestrator.ensureStarted(
        'aij-existing',
      ),
    ).rejects.toBe(databaseFailure);
    const sfnFailure = Object.assign(new Error('sfn denied'), { name: 'AccessDeniedException' });
    const claimed = item({ orchestrationState: 'STARTING', executionName: 'stable-attempt' });
    const send = vi
      .fn()
      .mockResolvedValueOnce({ Item: item() })
      .mockResolvedValueOnce({ Attributes: claimed });
    await expect(
      create(send, vi.fn().mockRejectedValueOnce(sfnFailure)).orchestrator.ensureStarted(
        'aij-existing',
      ),
    ).rejects.toBe(sfnFailure);
  });
});
