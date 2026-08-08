// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  Priority,
  type AIJob,
  Citation,
  GroundedAnswer,
  GroupProgressAnalysis,
  MinutesDraft,
  TaskProposal,
} from '@campusmeet/shared';
import {
  AIChatPanel,
  AIJobState,
  GroundedAnswerView,
  GroupSearchPanel,
  MinutesDraftPreview,
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

    fireEvent.change(screen.getByLabelText('Bạn muốn làm rõ điều gì?'), {
      target: { value: '  Quyết định nào đã được chốt?  ' },
    });
    expect(screen.getByText('32 / 4.000')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Hỏi CampusMeet' }));
    expect(onSubmit).toHaveBeenLastCalledWith({
      question: 'Quyết định nào đã được chốt?',
      intent: 'QUESTION_ANSWER',
    });

    fireEvent.click(screen.getByRole('button', { name: 'Tóm tắt phần đã lỡ' }));
    expect(onSubmit).toHaveBeenLastCalledWith(
      expect.objectContaining({ intent: 'LATE_JOIN_SUMMARY' }),
    );
  });

  it('locks the composer and announces grounded processing while pending', () => {
    render(<AIChatPanel isPending onSubmit={vi.fn()} />);

    expect(screen.getByRole('region', { name: 'Trợ lý cuộc họp' })).toHaveAttribute(
      'aria-busy',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Đang đối chiếu' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Tóm tắt phần đã lỡ' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Đang đối chiếu nguồn');
  });

  it('uses group wording and hides the meeting-only late-join action in group context', () => {
    render(<AIChatPanel context="group" onSubmit={vi.fn()} />);

    expect(screen.getByRole('region', { name: 'Trợ lý nhóm' })).toBeInTheDocument();
    expect(screen.getByText('Đối chiếu kiến thức nhóm')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Tóm tắt phần đã lỡ' })).not.toBeInTheDocument();
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

    expect(screen.getByRole('status')).toHaveTextContent('Chưa đủ căn cứ để trả lời');
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

    fireEvent.change(screen.getByLabelText('Câu hỏi cần đối chiếu'), {
      target: { value: 'Tiến độ thế nào?' },
    });
    expect(screen.getByRole('button', { name: 'Tìm trong nguồn' })).toBeDisabled();
    fireEvent.click(screen.getByLabelText('Sprint 1'));
    expect(screen.getByText('1 cuộc họp được chọn')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Tìm trong nguồn' }));
    expect(onSearch).toHaveBeenLastCalledWith({
      question: 'Tiến độ thế nào?',
      scope: 'SELECTED_MEETINGS',
      meetingIds: ['meeting-1'],
    });

    fireEvent.click(screen.getByLabelText(/Toàn bộ nhóm/));
    fireEvent.click(screen.getByRole('button', { name: 'Tìm trong nguồn' }));
    expect(onSearch).toHaveBeenLastCalledWith({
      question: 'Tiến độ thế nào?',
      scope: 'WHOLE_GROUP',
    });
  });

  it('keeps the selected scope visible while a search is pending', () => {
    render(
      <GroupSearchPanel
        isPending
        meetingOptions={[{ meetingId: 'meeting-1', title: 'Sprint 1' }]}
        onSearch={vi.fn()}
      />,
    );

    expect(screen.getByRole('form', { name: 'Tìm kiếm kiến thức nhóm' })).toHaveAttribute(
      'aria-busy',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Đang tìm' })).toBeDisabled();
    expect(screen.getByText('Đang kiểm tra nguồn trong phạm vi đã chọn')).toBeInTheDocument();
  });

  it('directs the user when no approved meeting is available', () => {
    render(<GroupSearchPanel meetingOptions={[]} onSearch={vi.fn()} />);

    expect(screen.getByText('Chưa có cuộc họp đã duyệt để tìm kiếm.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tìm trong nguồn' })).toBeDisabled();
  });
});

describe('MinutesDraftPreview', () => {
  it('keeps decisions, action items and evidence visibly separated', () => {
    const draft: MinutesDraft = {
      meetingId: 'meeting-1',
      summary: 'Nhóm thống nhất phạm vi bản demo.',
      topics: [{ content: 'Phạm vi MVP', citations: [citation] }],
      decisions: [{ content: 'Chỉ dùng Amazon Transcribe.', citations: [citation] }],
      actionItems: [{ content: 'Hoàn thiện luồng upload.', citations: [citation] }],
      citations: [citation],
    };

    render(<MinutesDraftPreview draft={draft} />);

    expect(screen.getByRole('heading', { name: 'Biên bản nháp' })).toBeInTheDocument();
    expect(screen.getByText('Chỉ dùng Amazon Transcribe.')).toBeInTheDocument();
    expect(screen.getByText('Hoàn thiện luồng upload.')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Nguồn tham khảo' })).toBeInTheDocument();
  });
});

describe('TaskProposalEditor', () => {
  it('requires missing fields and sends only editable confirmation fields', () => {
    const proposal: TaskProposal = {
      proposalId: 'proposal-1',
      groupId: 'group-1',
      meetingId: 'meeting-1',
      title: 'Hoàn thiện bản demo',
      missingFields: ['assigneeId', 'priority'],
      citations: [citation],
      status: 'PENDING',
    };
    const onConfirm = vi.fn();
    render(
      <TaskProposalEditor
        proposal={proposal}
        assigneeOptions={[{ userId: 'user-1', displayName: 'Lan Nguyễn' }]}
        onConfirm={onConfirm}
      />,
    );

    const confirmButton = screen.getByRole('button', { name: 'Xác nhận tạo công việc' });
    expect(confirmButton).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Người phụ trách'), {
      target: { value: 'user-1' },
    });
    fireEvent.change(screen.getByLabelText('Mức ưu tiên'), { target: { value: 'HIGH' } });
    fireEvent.change(screen.getByLabelText('Tiêu đề công việc'), {
      target: { value: '  Hoàn thiện bản demo cuối  ' },
    });
    fireEvent.change(screen.getByLabelText('Hạn hoàn thành'), {
      target: { value: '2026-08-10T10:30' },
    });
    fireEvent.click(confirmButton);

    expect(onConfirm).toHaveBeenCalledWith({
      proposalId: 'proposal-1',
      request: {
        title: 'Hoàn thiện bản demo cuối',
        assigneeId: 'user-1',
        priority: Priority.HIGH,
        dueAt: new Date('2026-08-10T10:30').toISOString(),
      },
    });
  });

  it('prevents rapid duplicate confirmation and exposes no optimistic task id', () => {
    const onConfirm = vi.fn();
    render(
      <TaskProposalEditor
        proposal={{
          proposalId: 'proposal-1',
          groupId: 'group-1',
          meetingId: 'meeting-1',
          title: 'Hoàn thiện bản demo',
          assigneeId: 'user-1',
          priority: 'MEDIUM',
          missingFields: [],
          citations: [citation],
          status: 'PENDING',
        }}
        assigneeOptions={[{ userId: 'user-1', displayName: 'Lan Nguyễn' }]}
        onConfirm={onConfirm}
      />,
    );

    const confirmButton = screen.getByRole('button', { name: 'Xác nhận tạo công việc' });
    fireEvent.click(confirmButton);
    fireEvent.click(confirmButton);

    expect(onConfirm).toHaveBeenCalledOnce();
    expect(confirmButton).toBeDisabled();
    expect(screen.queryByText(/Đã tạo công việc/)).not.toBeInTheDocument();
  });

  it('hides confirmation from non-admins and shows the authoritative confirmed task', () => {
    const { rerender } = render(
      <TaskProposalEditor
        proposal={{
          proposalId: 'proposal-1',
          groupId: 'group-1',
          meetingId: 'meeting-1',
          title: 'Hoàn thiện bản demo',
          assigneeId: 'user-1',
          priority: 'MEDIUM',
          missingFields: [],
          citations: [citation],
          status: 'PENDING',
        }}
        canConfirm={false}
        onConfirm={vi.fn()}
      />,
    );

    expect(
      screen.queryByRole('button', { name: 'Xác nhận tạo công việc' }),
    ).not.toBeInTheDocument();
    rerender(
      <TaskProposalEditor
        proposal={{
          proposalId: 'proposal-1',
          groupId: 'group-1',
          meetingId: 'meeting-1',
          title: 'Hoàn thiện bản demo',
          assigneeId: 'user-1',
          priority: 'MEDIUM',
          missingFields: [],
          citations: [citation],
          status: 'CONFIRMED',
          confirmedTaskId: 'task-authoritative',
        }}
        canConfirm={false}
        onConfirm={vi.fn()}
      />,
    );

    expect(screen.getByText('Đã tạo công việc task-authoritative.')).toBeInTheDocument();
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
    expect(screen.getByRole('alert')).toHaveTextContent('Phân tích dành cho Quản trị viên nhóm');
    expect(screen.queryByText(analysis.summary)).not.toBeInTheDocument();
  });

  it('separates observations and risks for a group admin', () => {
    render(<ProgressAnalysisPanel analysis={analysis} isGroupAdmin />);

    expect(screen.getByRole('heading', { name: 'Tiến độ nhóm' })).toBeInTheDocument();
    expect(screen.getByText('Ba tác vụ đã hoàn tất.')).toBeInTheDocument();
    expect(screen.getByText('Một tác vụ quá hạn.')).toBeInTheDocument();
    expect(screen.getByText('01/08/2026')).toHaveAttribute('datetime', '2026-08-01T01:00:00.000Z');
  });

  it('shows the grounded-processing state without exposing source content', () => {
    render(<AIJobState isLoading />);

    expect(screen.getByRole('status')).toHaveTextContent('Đang đối chiếu nguồn');
    expect(screen.getByRole('status')).not.toHaveTextContent(citation.excerpt!);
  });

  it('distinguishes a queued job from an actively processing job', () => {
    const queuedJob: AIJob = {
      aiJobId: 'job-1',
      groupId: 'group-1',
      meetingId: 'meeting-1',
      type: 'GENERATE_ANSWER',
      status: 'QUEUED',
      attempt: 0,
      requestId: 'request-1',
      createdAt: '2026-08-01T01:00:00.000Z',
      updatedAt: '2026-08-01T01:00:00.000Z',
    };

    render(<AIJobState job={queuedJob} />);

    expect(screen.getByRole('status')).toHaveTextContent('Yêu cầu đang chờ xử lý');
    expect(screen.getByRole('status')).not.toHaveTextContent('Đang đối chiếu nguồn');
  });

  it('shows a retry action after an AI job failure', () => {
    const onRetry = vi.fn();
    render(<AIJobState error={new Error('failed')} onRetry={onRetry} />);
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
