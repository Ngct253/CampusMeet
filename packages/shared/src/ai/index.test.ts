import { describe, expect, it } from 'vitest';
import {
  aiJobDetailSchema,
  groupKnowledgeQuerySchema,
  groupProgressAnalysisRequestSchema,
  groupProgressSnapshotSchema,
  knowledgeIngestionPayloadSchema,
  supportedDocumentContentTypes,
  taskProposalSchema,
} from './index';

describe('M5 shared schemas', () => {
  it('requires meeting ids only for selected-meeting search', () => {
    expect(
      groupKnowledgeQuerySchema.safeParse({
        question: 'Nhóm đã quyết định gì?',
        scope: 'SELECTED_MEETINGS',
      }).success,
    ).toBe(false);
    expect(
      groupKnowledgeQuerySchema.safeParse({
        question: 'Nhóm đã quyết định gì?',
        scope: 'WHOLE_GROUP',
        meetingIds: ['m1'],
      }).success,
    ).toBe(false);
  });

  it('rejects a task proposal without citations', () => {
    expect(
      taskProposalSchema.safeParse({
        proposalId: 'proposal-1',
        groupId: 'group-1',
        meetingId: 'meeting-1',
        title: 'Hoàn thành báo cáo',
        missingFields: ['assigneeId', 'priority'],
        citations: [],
        status: 'PENDING',
      }).success,
    ).toBe(false);
  });

  it('accepts every supported document type and rejects executable content', () => {
    const basePayload = {
      operation: 'INGEST_SOURCE',
      actorId: 'user-1',
      groupId: 'group-1',
      meetingId: 'meeting-1',
      sourceId: 'source-1',
      sourceType: 'ATTACHMENT',
      sourceVersion: 1,
      approved: true,
      inputObjectKey: 'uploads/group-1/meeting-1/source-1',
    };

    for (const contentType of supportedDocumentContentTypes) {
      expect(
        knowledgeIngestionPayloadSchema.safeParse({ ...basePayload, contentType }).success,
      ).toBe(true);
    }
    expect(
      knowledgeIngestionPayloadSchema.parse({
        ...basePayload,
        contentType: 'TEXT/MARKDOWN; charset=UTF-8',
      }).contentType,
    ).toBe('text/markdown');
    expect(
      knowledgeIngestionPayloadSchema.safeParse({
        ...basePayload,
        contentType: 'application/x-msdownload',
      }).success,
    ).toBe(false);
  });

  it('validates a grounded result returned by AI job polling', () => {
    const detail = aiJobDetailSchema.parse({
      aiJobId: 'job-1',
      groupId: 'group-1',
      meetingId: 'meeting-1',
      type: 'GENERATE_ANSWER',
      status: 'COMPLETED',
      attempt: 1,
      requestId: 'request-1',
      provider: 'BEDROCK',
      createdAt: '2026-08-03T00:00:00.000Z',
      updatedAt: '2026-08-03T00:01:00.000Z',
      result: {
        answer: 'Không có đủ nguồn để trả lời.',
        citations: [],
        scope: 'CURRENT_MEETING',
        insufficientContext: true,
      },
    });

    expect(detail.result).toMatchObject({ scope: 'CURRENT_MEETING' });
  });

  it('rejects a completed generation job without a result', () => {
    expect(
      aiJobDetailSchema.safeParse({
        aiJobId: 'job-1',
        groupId: 'group-1',
        type: 'GENERATE_ANSWER',
        status: 'COMPLETED',
        attempt: 1,
        requestId: 'request-1',
        createdAt: '2026-08-03T00:00:00.000Z',
        updatedAt: '2026-08-03T00:01:00.000Z',
      }).success,
    ).toBe(false);
  });

  it('rejects a result that does not match the AI job type', () => {
    expect(
      aiJobDetailSchema.safeParse({
        aiJobId: 'job-1',
        groupId: 'group-1',
        type: 'PROGRESS_ANALYSIS',
        status: 'COMPLETED',
        attempt: 1,
        requestId: 'request-1',
        createdAt: '2026-08-03T00:00:00.000Z',
        updatedAt: '2026-08-03T00:01:00.000Z',
        result: {
          answer: 'Đây không phải kết quả phân tích tiến độ.',
          citations: [],
          scope: 'WHOLE_GROUP',
          insufficientContext: false,
        },
      }).success,
    ).toBe(false);
  });
});

describe('groupProgressSnapshotSchema', () => {
  const validSnapshot = {
    groupId: 'group-1',
    version: 1,
    generatedAt: '2026-08-08T08:00:00.000Z',
    taskCounts: {
      total: 6,
      todo: 2,
      doing: 3,
      done: 1,
      overdue: 2,
    },
    meetingCounts: {
      completed: 4,
      upcoming: 2,
    },
  };

  it('accepts a valid snapshot', () => {
    expect(groupProgressSnapshotSchema.safeParse(validSnapshot).success).toBe(true);
  });

  it('requires a version', () => {
    const withoutVersion: Record<string, unknown> = { ...validSnapshot };
    delete withoutVersion.version;

    expect(groupProgressSnapshotSchema.safeParse(withoutVersion).success).toBe(false);
  });

  it.each([0, -1, 10_000_000_000, 1.5])('rejects invalid version %s', (version) => {
    expect(groupProgressSnapshotSchema.safeParse({ ...validSnapshot, version }).success).toBe(
      false,
    );
  });

  it('requires generatedAt to be an ISO datetime with timezone', () => {
    expect(
      groupProgressSnapshotSchema.safeParse({
        ...validSnapshot,
        generatedAt: '2026-08-08T08:00:00',
      }).success,
    ).toBe(false);
  });

  it('rejects negative counts', () => {
    expect(
      groupProgressSnapshotSchema.safeParse({
        ...validSnapshot,
        taskCounts: { ...validSnapshot.taskCounts, todo: -1 },
      }).success,
    ).toBe(false);
  });

  it('requires total to equal todo + doing + done', () => {
    expect(
      groupProgressSnapshotSchema.safeParse({
        ...validSnapshot,
        taskCounts: { ...validSnapshot.taskCounts, total: 7 },
      }).success,
    ).toBe(false);
  });

  it('rejects overdue counts greater than unfinished task counts', () => {
    expect(
      groupProgressSnapshotSchema.safeParse({
        ...validSnapshot,
        taskCounts: { ...validSnapshot.taskCounts, overdue: 6 },
      }).success,
    ).toBe(false);
  });

  it('rejects unknown fields', () => {
    expect(
      groupProgressSnapshotSchema.safeParse({ ...validSnapshot, recordType: 'LATEST' }).success,
    ).toBe(false);
    expect(
      groupProgressSnapshotSchema.safeParse({
        ...validSnapshot,
        taskCounts: { ...validSnapshot.taskCounts, blocked: 1 },
      }).success,
    ).toBe(false);
  });
});

describe('groupProgressAnalysisRequestSchema snapshotVersion', () => {
  it.each([1, 9_999_999_999])('accepts supported version %s', (snapshotVersion) => {
    expect(groupProgressAnalysisRequestSchema.safeParse({ snapshotVersion }).success).toBe(true);
  });

  it.each([0, -1, 1.5, 10_000_000_000])('rejects unsupported version %s', (snapshotVersion) => {
    expect(groupProgressAnalysisRequestSchema.safeParse({ snapshotVersion }).success).toBe(false);
  });
});
