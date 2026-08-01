// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  Citation,
  GroundedAnswer,
  GroupProgressAnalysis,
  TaskProposal,
} from '@campusmeet/shared';
import {
  AIChatPanel,
  AIJobState,
  GroundedAnswerView,
  GroupSearchPanel,
  ProgressAnalysisPanel,
  TaskProposalEditor,
} from './components';

const citation: Citation = {
  citationId: 'citation-1',
  groupId: 'group-1',
  meetingId: 'meeting-1',
  sourceType: 'TRANSCRIPT',
  sourceId: 'transcript-1',
  sourceVersion: 1,
  segmentId: 'segment-1',
  speakerLabel: 'Speaker 2',
  startMs: 65_000,
  excerpt: 'Nhóm thống nhất hoàn thành bản demo.',
  internalUri: 'campusmeet://meetings/meeting-1/transcripts/transcript-1/segments/segment-1',
};

afterEach(cleanup);

describe('AIChatPanel', () => {
  it('normalizes a question and exposes the late-join intent separately', () => {
    const onSubmit = vi.fn();
    render(<AIChatPanel onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText('Hỏi về tài liệu hoặc nội dung cuộc họp'), {
      target: { value: '  Quyết định nào đã được chốt?  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Gửi câu hỏi' }));
    expect(onSubmit).toHaveBeenLastCalledWith({
      question: 'Quyết định nào đã được chốt?',
      intent: 'QUESTION_ANSWER',
    });

    fireEvent.click(screen.getByRole('button', { name: 'Tóm tắt cho người vào trễ' }));
    expect(onSubmit).toHaveBeenLastCalledWith(
      expect.objectContaining({ intent: 'LATE_JOIN_SUMMARY' }),
    );
  });
});

describe('grounded output', () => {
  it('shows insufficient context without inventing an answer', () => {
    const answer: GroundedAnswer = {
      answer: 'Không đủ ngữ cảnh.',
      citations: [],
      scope: 'CURRENT_MEETING',
      insufficientContext: true,
    };
    render(<GroundedAnswerView answer={answer} />);

    expect(screen.getByRole('status')).toHaveTextContent('Chưa có đủ tài liệu');
    expect(screen.queryByText(answer.answer)).not.toBeInTheDocument();
  });

  it('opens only the internal citation object supplied by the API', () => {
    const onOpen = vi.fn();
    render(
      <GroundedAnswerView
        answer={{
          answer: 'Nhóm đã chốt bản demo.',
          citations: [citation],
          scope: 'CURRENT_MEETING',
          insufficientContext: false,
        }}
        onOpenCitation={onOpen}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /TRANSCRIPT · Speaker 2 · 1:05/ }));
    expect(onOpen).toHaveBeenCalledWith(citation);
    expect(document.body.textContent).not.toContain('https://');
  });
});

describe('GroupSearchPanel', () => {
  it('requires a selected meeting and omits meeting IDs for whole-group search', () => {
    const onSearch = vi.fn();
    render(
      <GroupSearchPanel
        meetingOptions={[
          { meetingId: 'meeting-1', title: 'Sprint 1' },
          { meetingId: 'meeting-2', title: 'Sprint 2' },
        ]}
        onSearch={onSearch}
      />,
    );

    fireEvent.change(screen.getByLabelText('Câu hỏi'), { target: { value: 'Tiến độ thế nào?' } });
    expect(screen.getByRole('button', { name: 'Tìm kiếm' })).toBeDisabled();
    fireEvent.click(screen.getByLabelText('Sprint 1'));
    fireEvent.click(screen.getByRole('button', { name: 'Tìm kiếm' }));
    expect(onSearch).toHaveBeenLastCalledWith({
      question: 'Tiến độ thế nào?',
      scope: 'SELECTED_MEETINGS',
      meetingIds: ['meeting-1'],
    });

    fireEvent.change(screen.getByLabelText('Phạm vi'), { target: { value: 'WHOLE_GROUP' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tìm kiếm' }));
    expect(onSearch).toHaveBeenLastCalledWith({
      question: 'Tiến độ thế nào?',
      scope: 'WHOLE_GROUP',
    });
  });
});

describe('TaskProposalEditor', () => {
  it('requires missing assignee and priority before handing off to M3 confirmation', () => {
    const proposal: TaskProposal = {
      proposalId: 'proposal-1',
      groupId: 'group-1',
      meetingId: 'meeting-1',
      title: 'Hoàn thiện bản demo',
      missingFields: ['assigneeId', 'priority'],
      citations: [citation],
      status: 'PENDING',
    };
    const onComplete = vi.fn();
    render(<TaskProposalEditor proposal={proposal} onComplete={onComplete} />);

    const completeButton = screen.getByRole('button', { name: 'Hoàn tất thông tin' });
    expect(completeButton).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Người phụ trách'), {
      target: { value: ' user-1 ' },
    });
    fireEvent.change(screen.getByLabelText('Mức ưu tiên'), { target: { value: 'HIGH' } });
    fireEvent.click(completeButton);

    expect(onComplete).toHaveBeenCalledWith({
      proposalId: 'proposal-1',
      assigneeId: 'user-1',
      priority: 'HIGH',
    });
  });
});

describe('authorization-facing states', () => {
  const analysis: GroupProgressAnalysis = {
    groupId: 'group-1',
    summary: 'Nhóm đã hoàn thành phần lớn công việc.',
    observations: ['Ba tác vụ đã hoàn tất.'],
    risks: ['Một tác vụ quá hạn.'],
    generatedAt: '2026-08-01T01:00:00.000Z',
  };

  it('does not expose progress analysis to a regular member', () => {
    render(<ProgressAnalysisPanel analysis={analysis} isGroupAdmin={false} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Chỉ Quản trị viên nhóm');
    expect(screen.queryByText(analysis.summary)).not.toBeInTheDocument();
  });

  it('shows a retry action after an AI job failure', () => {
    const onRetry = vi.fn();
    render(<AIJobState error={new Error('failed')} onRetry={onRetry} />);
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
