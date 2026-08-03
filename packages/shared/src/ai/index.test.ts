import { describe, expect, it } from 'vitest';
import {
  aiJobDetailSchema,
  groupKnowledgeQuerySchema,
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
});
