import { useState, type FormEvent, type ReactNode } from 'react';
import type {
  AIJob,
  Citation,
  GroundedAnswer,
  GroupProgressAnalysis,
  KnowledgeScope,
  MinutesDraft,
  TaskProposal,
} from '@campusmeet/shared';

const formatTime = (milliseconds: number) => {
  const totalSeconds = Math.floor(milliseconds / 1_000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
};

export function CitationViewer({
  citations,
  onOpen,
}: {
  citations: Citation[];
  onOpen?: (citation: Citation) => void;
}) {
  if (!citations.length) return null;
  return (
    <section aria-label="Nguồn tham khảo" className="ai-citations">
      <h4>Nguồn tham khảo</h4>
      <ol>
        {citations.map((citation) => (
          <li key={citation.citationId}>
            <button type="button" onClick={() => onOpen?.(citation)} disabled={!onOpen}>
              {citation.sourceType} · {citation.speakerLabel ?? citation.sourceId}
              {citation.startMs === undefined ? '' : ` · ${formatTime(citation.startMs)}`}
            </button>
            {citation.excerpt && <blockquote>{citation.excerpt}</blockquote>}
          </li>
        ))}
      </ol>
    </section>
  );
}

export function AIJobState({
  job,
  isLoading = false,
  error,
  onRetry,
  children,
}: {
  job?: AIJob;
  isLoading?: boolean;
  error?: Error | null;
  onRetry?: () => void;
  children?: ReactNode;
}) {
  if (isLoading || job?.status === 'QUEUED' || job?.status === 'PROCESSING') {
    return <div role="status">AI đang xử lý yêu cầu…</div>;
  }
  if (error || job?.status === 'FAILED' || job?.status === 'CANCELLED') {
    return (
      <div role="alert">
        <p>Không thể hoàn thành yêu cầu AI.</p>
        {onRetry && (
          <button type="button" onClick={onRetry}>
            Thử lại
          </button>
        )}
      </div>
    );
  }
  return <>{children}</>;
}

export function GroundedAnswerView({
  answer,
  onOpenCitation,
}: {
  answer: GroundedAnswer;
  onOpenCitation?: (citation: Citation) => void;
}) {
  if (answer.insufficientContext) {
    return (
      <div role="status">
        Chưa có đủ tài liệu hoặc nội dung cuộc họp đã duyệt để trả lời câu hỏi này.
      </div>
    );
  }
  return (
    <article className="ai-answer">
      <p>{answer.answer}</p>
      <CitationViewer citations={answer.citations} onOpen={onOpenCitation} />
    </article>
  );
}

export function AIChatPanel({
  answer,
  isPending = false,
  error,
  onSubmit,
  onOpenCitation,
}: {
  answer?: GroundedAnswer;
  isPending?: boolean;
  error?: Error | null;
  onSubmit: (input: { question: string; intent: 'QUESTION_ANSWER' | 'LATE_JOIN_SUMMARY' }) => void;
  onOpenCitation?: (citation: Citation) => void;
}) {
  const [question, setQuestion] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const normalized = question.trim();
    if (normalized) onSubmit({ question: normalized, intent: 'QUESTION_ANSWER' });
  };
  return (
    <section aria-label="Trợ lý cuộc họp" className="ai-chat-panel">
      <form onSubmit={submit}>
        <label htmlFor="ai-question">Hỏi về tài liệu hoặc nội dung cuộc họp</label>
        <textarea
          id="ai-question"
          value={question}
          maxLength={4_000}
          onChange={(event) => setQuestion(event.target.value)}
        />
        <div>
          <button type="submit" disabled={isPending || !question.trim()}>
            Gửi câu hỏi
          </button>
          <button
            type="button"
            disabled={isPending}
            onClick={() =>
              onSubmit({
                question: 'Tóm tắt phần nội dung cuộc họp đã diễn ra trước khi tôi tham gia.',
                intent: 'LATE_JOIN_SUMMARY',
              })
            }
          >
            Tóm tắt cho người vào trễ
          </button>
        </div>
      </form>
      {isPending && <div role="status">AI đang xử lý yêu cầu…</div>}
      {error && <div role="alert">Không thể gửi câu hỏi. Vui lòng thử lại.</div>}
      {answer && <GroundedAnswerView answer={answer} onOpenCitation={onOpenCitation} />}
    </section>
  );
}

export function GroupSearchPanel({
  meetingOptions,
  isPending = false,
  onSearch,
}: {
  meetingOptions: Array<{ meetingId: string; title: string }>;
  isPending?: boolean;
  onSearch: (input: { question: string; scope: KnowledgeScope; meetingIds?: string[] }) => void;
}) {
  const [question, setQuestion] = useState('');
  const [scope, setScope] = useState<'SELECTED_MEETINGS' | 'WHOLE_GROUP'>('SELECTED_MEETINGS');
  const [meetingIds, setMeetingIds] = useState<string[]>([]);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const normalized = question.trim();
    if (!normalized || (scope === 'SELECTED_MEETINGS' && !meetingIds.length)) return;
    onSearch({
      question: normalized,
      scope,
      ...(scope === 'SELECTED_MEETINGS' ? { meetingIds } : {}),
    });
  };
  return (
    <form aria-label="Tìm kiếm kiến thức nhóm" onSubmit={submit}>
      <label htmlFor="ai-group-question">Câu hỏi</label>
      <input
        id="ai-group-question"
        value={question}
        maxLength={4_000}
        onChange={(event) => setQuestion(event.target.value)}
      />
      <label htmlFor="ai-search-scope">Phạm vi</label>
      <select
        id="ai-search-scope"
        value={scope}
        onChange={(event) => setScope(event.target.value as 'SELECTED_MEETINGS' | 'WHOLE_GROUP')}
      >
        <option value="SELECTED_MEETINGS">Các cuộc họp được chọn</option>
        <option value="WHOLE_GROUP">Toàn bộ nhóm</option>
      </select>
      {scope === 'SELECTED_MEETINGS' && (
        <fieldset>
          <legend>Chọn cuộc họp</legend>
          {meetingOptions.map((meeting) => (
            <label key={meeting.meetingId}>
              <input
                type="checkbox"
                checked={meetingIds.includes(meeting.meetingId)}
                onChange={(event) =>
                  setMeetingIds((current) =>
                    event.target.checked
                      ? [...current, meeting.meetingId]
                      : current.filter((id) => id !== meeting.meetingId),
                  )
                }
              />
              {meeting.title}
            </label>
          ))}
        </fieldset>
      )}
      <button
        type="submit"
        disabled={
          isPending || !question.trim() || (scope === 'SELECTED_MEETINGS' && !meetingIds.length)
        }
      >
        Tìm kiếm
      </button>
    </form>
  );
}

const GroundedList = ({ title, items }: { title: string; items: MinutesDraft['topics'] }) => (
  <section>
    <h4>{title}</h4>
    {items.length ? (
      <ul>
        {items.map((item, index) => (
          <li key={`${title}-${index}`}>{item.content}</li>
        ))}
      </ul>
    ) : (
      <p>Không có nội dung được ghi nhận.</p>
    )}
  </section>
);

export function MinutesDraftPreview({ draft }: { draft: MinutesDraft }) {
  return (
    <article className="ai-minutes-draft">
      <h3>Biên bản nháp</h3>
      <p>{draft.summary}</p>
      <GroundedList title="Chủ đề" items={draft.topics} />
      <GroundedList title="Quyết định" items={draft.decisions} />
      <GroundedList title="Action item đã được nêu" items={draft.actionItems} />
      <CitationViewer citations={draft.citations} />
    </article>
  );
}

export interface CompletedTaskProposalFields {
  proposalId: string;
  assigneeId: string;
  priority: 'LOW' | 'MEDIUM' | 'HIGH';
}

export function TaskProposalEditor({
  proposal,
  onComplete,
}: {
  proposal: TaskProposal;
  onComplete: (fields: CompletedTaskProposalFields) => void;
}) {
  const [assigneeId, setAssigneeId] = useState(proposal.assigneeId ?? '');
  const [priority, setPriority] = useState<TaskProposal['priority']>(proposal.priority);
  return (
    <article className="ai-task-proposal">
      <h4>{proposal.title}</h4>
      {proposal.description && <p>{proposal.description}</p>}
      <label>
        Người phụ trách
        <input value={assigneeId} onChange={(event) => setAssigneeId(event.target.value)} />
      </label>
      <label>
        Mức ưu tiên
        <select
          value={priority ?? ''}
          onChange={(event) => {
            const selectedPriority = event.target.value;
            setPriority(
              selectedPriority ? (selectedPriority as 'LOW' | 'MEDIUM' | 'HIGH') : undefined,
            );
          }}
        >
          <option value="">Chọn mức ưu tiên</option>
          <option value="LOW">Thấp</option>
          <option value="MEDIUM">Trung bình</option>
          <option value="HIGH">Cao</option>
        </select>
      </label>
      <button
        type="button"
        disabled={!assigneeId.trim() || !priority}
        onClick={() =>
          priority &&
          onComplete({ proposalId: proposal.proposalId, assigneeId: assigneeId.trim(), priority })
        }
      >
        Hoàn tất thông tin
      </button>
      <CitationViewer citations={proposal.citations} />
    </article>
  );
}

export function ProgressAnalysisPanel({
  analysis,
  isGroupAdmin,
}: {
  analysis?: GroupProgressAnalysis;
  isGroupAdmin: boolean;
}) {
  if (!isGroupAdmin)
    return <div role="alert">Chỉ Quản trị viên nhóm được xem phân tích tiến độ.</div>;
  if (!analysis) return <div role="status">Chưa có phân tích tiến độ.</div>;
  return (
    <article className="ai-progress-analysis">
      <h3>Phân tích tiến độ nhóm</h3>
      <p>{analysis.summary}</p>
      <h4>Quan sát</h4>
      <ul>
        {analysis.observations.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      <h4>Rủi ro</h4>
      <ul>
        {analysis.risks.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </article>
  );
}
