import { describe, expect, it, vi } from 'vitest';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { MAX_TRANSCRIPT_VERSION, type Transcript } from '@campusmeet/shared';
import {
  decodeTranscriptCursor,
  encodeTranscriptCursor,
  transcriptReferenceKey,
  transcriptApprovalHandoffKey,
  transcriptSegmentKey,
  DynamoDbTranscriptRepository,
} from '../src/repositories/transcripts';
const transcript: Transcript = {
  transcriptId: 'tx',
  meetingId: 'meeting-1',
  groupId: 'group-1',
  status: 'READY',
  version: 1,
  createdAt: '2026-08-08T00:00:00.000Z',
  updatedAt: '2026-08-08T00:00:00.000Z',
};
const segment = (id: string, sequence: number) => ({
  PK: 'TRANSCRIPT#tx',
  SK: transcriptSegmentKey(sequence, id),
  entityType: 'TRANSCRIPT_SEGMENT',
  segmentId: id,
  transcriptId: 'tx',
  sequence,
  startMs: 0,
  endMs: 100,
  text: `Text ${id}`,
  confidence: 0.9,
  languageCode: 'vi-VN',
  speakerLabel: 'Speaker 1',
  isFinal: true,
  version: 1,
});
const meta = (value: Transcript = transcript) => ({
  PK: `TRANSCRIPT#${value.transcriptId}`,
  SK: 'META',
  entityType: 'TRANSCRIPT',
  ...value,
});
const reference = (version = 1) => ({
  PK: 'MEETING#meeting-1',
  SK: transcriptReferenceKey(version, 'tx'),
  entityType: 'TRANSCRIPT_REFERENCE',
  meetingId: 'meeting-1',
  groupId: 'group-1',
  transcriptId: 'tx',
  version,
});
const repositoryWith = (...responses: unknown[]) => {
  const send = vi.fn();
  responses.forEach((response) => send.mockResolvedValueOnce(response));
  return {
    repository: new DynamoDbTranscriptRepository(
      { send } as unknown as DynamoDBDocumentClient,
      'table',
    ),
    send,
  };
};
describe('transcript repository keys and cursor', () => {
  it('pads immutable Meeting references and segment ordering', () => {
    expect(transcriptReferenceKey(12, 'tx')).toBe('TRANSCRIPT#0000000012#tx');
    expect(transcriptSegmentKey(7, 'seg')).toBe('SEGMENT#0000000007#seg');
  });
  it('round-trips an opaque scoped cursor without exposing the key', () => {
    const cursor = encodeTranscriptCursor('meeting-1', 'tx', {
      PK: 'TRANSCRIPT#tx',
      SK: 'SEGMENT#0000000007#seg',
    })!;
    expect(cursor).not.toContain('SEGMENT');
    expect(decodeTranscriptCursor('meeting-1', 'tx', cursor)).toEqual({
      PK: 'TRANSCRIPT#tx',
      SK: 'SEGMENT#0000000007#seg',
    });
  });
  it('rejects malformed and cross-scope cursors', () => {
    expect(() => decodeTranscriptCursor('meeting-1', 'tx', '%%%')).toThrow();
    const cursor = encodeTranscriptCursor('meeting-1', 'tx', {
      PK: 'TRANSCRIPT#tx',
      SK: 'SEGMENT#0000000007#seg',
    });
    expect(() => decodeTranscriptCursor('meeting-2', 'tx', cursor)).toThrow();
  });
});
describe('transcript segment lookup pagination', () => {
  it('finds the target on the second Query page and uses ExclusiveStartKey', async () => {
    const key = { PK: 'TRANSCRIPT#tx', SK: 'SEGMENT#0000000001#first' };
    const { repository, send } = repositoryWith(
      { Items: [segment('first', 1)], LastEvaluatedKey: key },
      { Items: [segment('target', 2)] },
      {},
    );
    await expect(
      repository.updateSegment({
        transcript,
        segmentId: 'target',
        actorId: 'admin',
        update: { expectedVersion: 1, text: 'Changed' },
      }),
    ).resolves.toBeDefined();
    expect(send.mock.calls[1]![0].input.ExclusiveStartKey).toEqual(key);
  });
  it('returns 404 only after all Query pages are exhausted', async () => {
    const key = { PK: 'TRANSCRIPT#tx', SK: 'SEGMENT#0000000001#first' };
    const { repository } = repositoryWith(
      { Items: [segment('first', 1)], LastEvaluatedKey: key },
      { Items: [segment('second', 2)] },
    );
    await expect(
      repository.updateSegment({
        transcript,
        segmentId: 'missing',
        actorId: 'admin',
        update: { expectedVersion: 1, text: 'Changed' },
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
  it('fails integrity when LastEvaluatedKey does not advance', async () => {
    const key = { PK: 'TRANSCRIPT#tx', SK: 'SEGMENT#0000000001#first' };
    const { repository } = repositoryWith(
      { Items: [segment('first', 1)], LastEvaluatedKey: key },
      { Items: [segment('second', 2)], LastEvaluatedKey: key },
    );
    await expect(
      repository.updateSegment({
        transcript,
        segmentId: 'missing',
        actorId: 'admin',
        update: { expectedVersion: 1, text: 'Changed' },
      }),
    ).rejects.toThrow('TRANSCRIPT_DATA_INTEGRITY');
  });
  it('fails integrity for a non-consecutive A to B to A cursor cycle', async () => {
    const a = { PK: 'TRANSCRIPT#tx', SK: 'SEGMENT#0000000001#a' };
    const b = { PK: 'TRANSCRIPT#tx', SK: 'SEGMENT#0000000002#b' };
    const { repository } = repositoryWith(
      { Items: [segment('a', 1)], LastEvaluatedKey: a },
      { Items: [segment('b', 2)], LastEvaluatedKey: b },
      { Items: [segment('c', 3)], LastEvaluatedKey: a },
    );
    await expect(
      repository.updateSegment({
        transcript,
        segmentId: 'missing',
        actorId: 'admin',
        update: { expectedVersion: 1, text: 'Changed' },
      }),
    ).rejects.toThrow('TRANSCRIPT_DATA_INTEGRITY');
  });
});
describe('canonical reference integrity', () => {
  it.each([undefined, 'other-group'])(
    'rejects a missing or mismatched reference groupId',
    async (groupId) => {
      const reference = {
        PK: 'MEETING#meeting-1',
        SK: 'TRANSCRIPT#0000000001#tx',
        entityType: 'TRANSCRIPT_REFERENCE',
        meetingId: 'meeting-1',
        transcriptId: 'tx',
        version: 1,
        ...(groupId ? { groupId } : {}),
      };
      const { repository } = repositoryWith({ Items: [reference] });
      await expect(repository.getCanonical('meeting-1', 'group-1', 50)).rejects.toThrow(
        'TRANSCRIPT_DATA_INTEGRITY',
      );
    },
  );
});
describe('edit transaction invariants', () => {
  it('writes exactly META, Segment, immutable audit, and immutable N+1 Meeting reference', async () => {
    const { repository, send } = repositoryWith({ Items: [segment('target', 2)] }, {});
    const result = await repository.updateSegment({
      transcript,
      segmentId: 'target',
      actorId: 'admin',
      update: { expectedVersion: 1, languageCode: 'en-US', text: 'Changed' },
    });
    const input = send.mock.calls[1]![0].input;
    const operations = input.TransactItems;
    expect(operations).toHaveLength(4);
    const [metaWrite, segmentWrite, auditWrite, referenceWrite] = operations.map(
      (entry: Record<string, unknown>) => entry.Put,
    );
    expect(metaWrite.Item).toMatchObject({
      PK: 'TRANSCRIPT#tx',
      SK: 'META',
      entityType: 'TRANSCRIPT',
      version: 2,
      status: 'READY',
      meetingId: 'meeting-1',
      groupId: 'group-1',
    });
    expect(metaWrite.ConditionExpression).toContain('#version = :old');
    expect(metaWrite.ConditionExpression).toContain('#status IN (:ready, :approved)');
    expect(metaWrite.ConditionExpression).toContain('meetingId = :meetingId');
    expect(metaWrite.ConditionExpression).toContain('groupId = :groupId');
    expect(segmentWrite.Item).toMatchObject({
      SK: 'SEGMENT#0000000002#target',
      version: 2,
      updatedBy: 'admin',
    });
    expect(Date.parse(segmentWrite.Item.updatedAt)).not.toBeNaN();
    expect(referenceWrite.Item.SK).toBe('TRANSCRIPT#0000000002#tx');
    expect(referenceWrite.ConditionExpression).toBe(
      'attribute_not_exists(PK) AND attribute_not_exists(SK)',
    );
    expect(auditWrite.Item).toMatchObject({
      entityType: 'TRANSCRIPT_EDIT',
      beforeVersion: 1,
      afterVersion: 2,
      changedFields: ['text', 'languageCode'],
    });
    expect(auditWrite.ConditionExpression).toBe(
      'attribute_not_exists(PK) AND attribute_not_exists(SK)',
    );
    expect(auditWrite.Item).not.toHaveProperty('text');
    expect(auditWrite.Item).not.toHaveProperty('before');
    expect(auditWrite.Item).not.toHaveProperty('after');
    expect(result.segment.version).toBe(2);
  });
  it('edits APPROVED to READY while preserving approval provenance', async () => {
    const approved = {
      ...transcript,
      status: 'APPROVED' as const,
      version: 4,
      approvedVersion: 4,
      approvedBy: 'user-x',
      approvedAt: '2026-08-07T00:00:00.000Z',
    };
    const { repository } = repositoryWith({ Items: [{ ...segment('target', 2), version: 4 }] }, {});
    const result = await repository.updateSegment({
      transcript: approved,
      segmentId: 'target',
      actorId: 'admin',
      update: { expectedVersion: 4, text: 'Changed' },
    });
    expect(result.transcript).toMatchObject({
      status: 'READY',
      version: 5,
      approvedVersion: 4,
      approvedBy: 'user-x',
      approvedAt: '2026-08-07T00:00:00.000Z',
    });
  });
  it('fails at max version before issuing any command', async () => {
    const { repository, send } = repositoryWith();
    await expect(
      repository.updateSegment({
        transcript: { ...transcript, version: MAX_TRANSCRIPT_VERSION },
        segmentId: 'target',
        actorId: 'admin',
        update: { expectedVersion: MAX_TRANSCRIPT_VERSION, text: 'Changed' },
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(send).not.toHaveBeenCalled();
  });
});

describe('approval transaction invariants', () => {
  const preparedJob = {
    aiJobId: 'aij-approval',
    job: {
      aiJobId: 'aij-approval',
      groupId: 'group-1',
      meetingId: 'meeting-1',
      type: 'INGEST_SOURCE' as const,
      status: 'QUEUED' as const,
      attempt: 0,
      requestId: 'request-1',
      createdAt: '2026-08-08T00:00:00.000Z',
      updatedAt: '2026-08-08T00:00:00.000Z',
    },
    payload: {
      operation: 'INGEST_SOURCE' as const,
      actorId: 'admin',
      groupId: 'group-1',
      meetingId: 'meeting-1',
      sourceId: 'tx',
      sourceType: 'TRANSCRIPT' as const,
      sourceVersion: 1,
      approved: true as const,
      inputObjectKey: 'uploads/group-1/meeting-1/transcripts/tx/v1/content.txt',
      contentType: 'text/plain' as const,
    },
    persistenceContribution: {
      Put: {
        TableName: 'ai-work',
        Item: { PK: 'AIJOB#aij-approval', SK: 'META' },
        ConditionExpression: 'attribute_not_exists(PK)',
      },
    },
  };

  it('writes approval, text-free audit, unique handoff, AIJob, and HTTP intent atomically', async () => {
    const { repository, send } = repositoryWith({});
    const result = await repository.approve({
      transcript,
      actorId: 'admin',
      requestId: 'request-1',
      idempotencyKey: 'idem-1',
      request: { expectedVersion: 1 },
      artifactObjectKey: 'uploads/group-1/meeting-1/transcripts/tx/v1/content.txt',
      artifactChecksum: 'sha256',
      preparedJob,
    });
    const writes = send.mock.calls[0]![0].input.TransactItems;
    expect(writes).toHaveLength(5);
    expect(writes[0].Put).toMatchObject({
      Item: {
        status: 'APPROVED',
        version: 1,
        approvedVersion: 1,
        approvedBy: 'admin',
      },
      ConditionExpression: expect.stringContaining('#status = :ready'),
    });
    expect(writes[1].Put.Item).toMatchObject({
      entityType: 'TRANSCRIPT_APPROVAL',
      approvedVersion: 1,
      aiJobId: 'aij-approval',
    });
    expect(writes[1].Put.Item).not.toHaveProperty('text');
    expect(writes[1].Put.Item).not.toHaveProperty('segments');
    expect(writes[2].Put).toMatchObject({
      Item: {
        SK: transcriptApprovalHandoffKey(1),
        entityType: 'TRANSCRIPT_APPROVAL_HANDOFF',
        aiJobId: 'aij-approval',
      },
      ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
    });
    expect(writes[3]).toBe(preparedJob.persistenceContribution);
    expect(writes[4].Put.Item).toMatchObject({
      entityType: 'TRANSCRIPT_APPROVAL_IDEMPOTENCY',
      transcriptId: 'tx',
      expectedVersion: 1,
    });
    expect(result.transcript).toMatchObject({ status: 'APPROVED', version: 1 });
  });

  it('returns a concurrent approval winner and its authoritative job', async () => {
    const cancelled = Object.assign(new Error('cancelled'), {
      name: 'TransactionCanceledException',
    });
    const approved = {
      ...transcript,
      status: 'APPROVED' as const,
      approvedVersion: 1,
      approvedBy: 'other-admin',
      approvedAt: '2026-08-08T01:00:00.000Z',
      updatedAt: '2026-08-08T01:00:00.000Z',
    };
    const handoff = {
      PK: 'TRANSCRIPT#tx',
      SK: transcriptApprovalHandoffKey(1),
      entityType: 'TRANSCRIPT_APPROVAL_HANDOFF',
      transcriptId: 'tx',
      meetingId: 'meeting-1',
      groupId: 'group-1',
      approvedVersion: 1,
      artifactObjectKey: 'uploads/group-1/meeting-1/transcripts/tx/v1/content.txt',
      artifactChecksum: 'sha256',
      aiJobId: 'winner-job',
      aiOperation: 'INGEST_SOURCE',
      aiJobType: 'INGEST_SOURCE',
      createdAt: '2026-08-08T01:00:00.000Z',
      updatedAt: '2026-08-08T01:00:00.000Z',
    };
    const { repository } = repositoryWith(
      Promise.reject(cancelled),
      {},
      { Item: meta(approved) },
      { Item: handoff },
    );
    await expect(
      repository.approve({
        transcript,
        actorId: 'admin',
        requestId: 'request-1',
        idempotencyKey: 'different-key',
        request: { expectedVersion: 1 },
        artifactObjectKey: handoff.artifactObjectKey,
        artifactChecksum: 'sha256',
        preparedJob,
      }),
    ).resolves.toMatchObject({ created: false, handoff: { aiJobId: 'winner-job' } });
  });

  it('maps a concurrent edit to version conflict only after authoritative reread', async () => {
    const cancelled = Object.assign(new Error('cancelled'), {
      name: 'TransactionCanceledException',
    });
    const { repository } = repositoryWith(
      Promise.reject(cancelled),
      {},
      { Item: meta({ ...transcript, version: 2 }) },
      {},
    );
    await expect(
      repository.approve({
        transcript,
        actorId: 'admin',
        requestId: 'request-1',
        idempotencyKey: 'idem',
        request: { expectedVersion: 1 },
        artifactObjectKey: 'uploads/group-1/meeting-1/transcripts/tx/v1/content.txt',
        artifactChecksum: 'sha256',
        preparedJob,
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });
});
describe('transaction cancellation recovery', () => {
  const cancelled = Object.assign(new Error('cancelled'), { name: 'TransactionCanceledException' });
  const denied = Object.assign(new Error('denied'), { name: 'AccessDeniedException' });
  const run = async (error: Error, current?: Transcript) => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({ Items: [segment('target', 2)] })
      .mockRejectedValueOnce(error);
    if (current) send.mockResolvedValueOnce({ Item: meta(current) });
    const repository = new DynamoDbTranscriptRepository(
      { send } as unknown as DynamoDBDocumentClient,
      'table',
    );
    return {
      promise: repository.updateSegment({
        transcript,
        segmentId: 'target',
        actorId: 'admin',
        update: { expectedVersion: 1, text: 'Changed' },
      }),
      send,
    };
  };
  it('maps an advanced version to 409', async () => {
    const { promise } = await run(cancelled, { ...transcript, version: 2 });
    await expect(promise).rejects.toMatchObject({ statusCode: 409 });
  });
  it('maps a no-longer-editable lifecycle to 409', async () => {
    const { promise } = await run(cancelled, { ...transcript, status: 'LIVE' });
    await expect(promise).rejects.toMatchObject({ statusCode: 409 });
  });
  it('rethrows unexplained cancellation unchanged', async () => {
    const { promise } = await run(cancelled, transcript);
    await expect(promise).rejects.toBe(cancelled);
  });
  it('rethrows non-cancellation failures unchanged', async () => {
    const { promise } = await run(denied);
    await expect(promise).rejects.toBe(denied);
  });
});
describe('persisted record integrity', () => {
  it.each([{ entityType: 'WRONG' }, { PK: 'TRANSCRIPT#other' }])(
    'rejects malformed META envelope',
    async (override) => {
      const { repository } = repositoryWith({ Item: { ...meta(), ...override } });
      await expect(repository.getById('tx')).rejects.toThrow('TRANSCRIPT_DATA_INTEGRITY');
    },
  );
  it.each([{ SK: 'SEGMENT#0000000009#wrong' }, { isFinal: false }, { transcriptId: 'other' }])(
    'rejects malformed persisted Segment',
    async (override) => {
      const { repository } = repositoryWith({ Items: [{ ...segment('target', 2), ...override }] });
      await expect(
        repository.updateSegment({
          transcript,
          segmentId: 'target',
          actorId: 'admin',
          update: { expectedVersion: 1, text: 'Changed' },
        }),
      ).rejects.toThrow('TRANSCRIPT_DATA_INTEGRITY');
    },
  );
  it('rejects reference version inconsistent with META', async () => {
    const { repository } = repositoryWith({ Items: [reference(2)] }, { Item: meta() });
    await expect(repository.getCanonical('meeting-1', 'group-1', 50)).rejects.toThrow(
      'TRANSCRIPT_DATA_INTEGRITY',
    );
  });
});
