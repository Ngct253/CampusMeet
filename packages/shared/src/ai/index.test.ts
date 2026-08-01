import { describe, expect, it } from 'vitest';
import { groupKnowledgeQuerySchema, taskProposalSchema } from './index';

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
});
