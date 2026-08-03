import { useId, useState, type FormEvent, type ReactNode } from 'react';
import type {
  AIJob,
  Citation,
  GroundedAnswer,
  GroupProgressAnalysis,
  KnowledgeScope,
  MinutesDraft,
  TaskProposal,
} from '@campusmeet/shared';
import './ai.css';

type IconName =
  | 'arrow'
  | 'book'
  | 'check'
  | 'clock'
  | 'document'
  | 'message'
  | 'search'
  | 'spark'
  | 'tasks'
  | 'warning';

function AIIcon({ name, size = 18 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, ReactNode> = {
    arrow: <path d="m9 18 6-6-6-6m6 6H3" />,
    book: (
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20M4 4.5A2.5 2.5 0 0 1 6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5z" />
    ),
    check: <path d="m5 12 4 4L19 6" />,
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    document: (
      <>
        <path d="M6 2h9l4 4v16H6z" />
        <path d="M14 2v5h5M9 13h7M9 17h5" />
      </>
    ),
    message: <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" />,
    search: (
      <>
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="m16 16 5 5" />
      </>
    ),
    spark: (
      <>
        <path d="m12 3 1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6z" />
        <path d="m19 15 .8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" />
      </>
    ),
    tasks: (
      <>
        <path d="M9 6h11M9 12h11M9 18h11" />
        <path d="m3 6 1 1 2-2m-3 7 1 1 2-2m-3 7 1 1 2-2" />
      </>
    ),
    warning: (
      <>
        <path d="M12 3 2.5 20h19z" />
        <path d="M12 9v4m0 3h.01" />
      </>
    ),
  };

  return (
    <svg
      aria-hidden="true"
      className="ai-icon"
      fill="none"
      height={size}
      viewBox="0 0 24 24"
      width={size}
    >
      <g stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8">
        {paths[name]}
      </g>
    </svg>
  );
}

const formatTime = (milliseconds: number) => {
  const totalSeconds = Math.floor(milliseconds / 1_000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
};

const sourceTypeLabels: Record<Citation['sourceType'], string> = {
  ATTACHMENT: 'Tài liệu',
  TRANSCRIPT: 'Bản ghi',
  MINUTES: 'Biên bản',
};

const scopeLabels: Record<GroundedAnswer['scope'], string> = {
  CURRENT_MEETING: 'Cuộc họp hiện tại',
  SELECTED_MEETINGS: 'Các cuộc họp đã chọn',
  WHOLE_GROUP: 'Toàn nhóm',
};

function PanelHeader({
  icon,
  eyebrow,
  title,
  description,
  aside,
}: {
  icon: IconName;
  eyebrow: string;
  title: string;
  description: string;
  aside?: ReactNode;
}) {
  return (
    <header className="ai-panel-header">
      <div className="ai-panel-header__mark">
        <AIIcon name={icon} size={21} />
      </div>
      <div className="ai-panel-header__copy">
        <span className="ai-eyebrow">{eyebrow}</span>
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
      {aside && <div className="ai-panel-header__aside">{aside}</div>}
    </header>
  );
}

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
      <header className="ai-citations__header">
        <span>
          <AIIcon name="book" size={16} />
          Nguồn tham khảo
        </span>
        <strong>{citations.length} nguồn</strong>
      </header>
      <ol className="ai-source-rail">
        {citations.map((citation, index) => {
          const location = citation.speakerLabel ?? citation.sourceId;
          const timestamp =
            citation.startMs === undefined ? undefined : formatTime(citation.startMs);
          const content = (
            <>
              <span className="ai-source-rail__meta">
                <span className="ai-source-type">{sourceTypeLabels[citation.sourceType]}</span>
                <span>{location}</span>
                {timestamp && <time>{timestamp}</time>}
              </span>
              {citation.excerpt && (
                <span className="ai-source-rail__excerpt">{citation.excerpt}</span>
              )}
              {onOpen && (
                <span className="ai-source-rail__action">
                  Mở đúng đoạn
                  <AIIcon name="arrow" size={15} />
                </span>
              )}
            </>
          );
          return (
            <li key={citation.citationId}>
              <span aria-hidden="true" className="ai-source-rail__marker">
                {String(index + 1).padStart(2, '0')}
              </span>
              {onOpen ? (
                <button
                  aria-label={`Mở nguồn ${citation.sourceType} · ${location}${timestamp ? ` · ${timestamp}` : ''}`}
                  className="ai-source-rail__card"
                  onClick={() => onOpen(citation)}
                  type="button"
                >
                  {content}
                </button>
              ) : (
                <div className="ai-source-rail__card">{content}</div>
              )}
            </li>
          );
        })}
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
    const isQueued = job?.status === 'QUEUED' && !isLoading;
    return (
      <div className="ai-feedback ai-feedback--working" role="status">
        <span aria-hidden="true" className="ai-orbit">
          <span />
        </span>
        <div>
          <strong>{isQueued ? 'Yêu cầu đang chờ xử lý' : 'Đang đối chiếu nguồn'}</strong>
          <p>
            {isQueued
              ? 'CampusMeet sẽ bắt đầu ngay khi tài nguyên xử lý sẵn sàng.'
              : 'CampusMeet đang đọc tài liệu và nội dung cuộc họp bạn được phép xem.'}
          </p>
        </div>
      </div>
    );
  }
  if (error || job?.status === 'FAILED' || job?.status === 'CANCELLED') {
    return (
      <div className="ai-feedback ai-feedback--error" role="alert">
        <span className="ai-feedback__icon">
          <AIIcon name="warning" />
        </span>
        <div>
          <strong>Không thể hoàn thành yêu cầu</strong>
          <p>Nguồn chưa sẵn sàng hoặc phiên xử lý đã gián đoạn.</p>
          {onRetry && (
            <button className="ai-button ai-button--quiet" type="button" onClick={onRetry}>
              Thử lại
              <AIIcon name="arrow" size={16} />
            </button>
          )}
        </div>
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
      <div className="ai-feedback ai-feedback--empty" role="status">
        <span className="ai-feedback__icon">
          <AIIcon name="book" />
        </span>
        <div>
          <strong>Chưa đủ căn cứ để trả lời</strong>
          <p>Hãy thêm tài liệu hoặc duyệt bản ghi cuộc họp rồi thử lại câu hỏi này.</p>
        </div>
      </div>
    );
  }
  return (
    <article className="ai-answer">
      <header className="ai-answer__header">
        <span className="ai-answer__mark">
          <AIIcon name="spark" size={18} />
        </span>
        <div>
          <span className="ai-eyebrow">Câu trả lời có căn cứ</span>
          <strong>{scopeLabels[answer.scope]}</strong>
        </div>
      </header>
      <p className="ai-answer__copy">{answer.answer}</p>
      <CitationViewer citations={answer.citations} onOpen={onOpenCitation} />
    </article>
  );
}

export function AIChatPanel({
  answer,
  isPending = false,
  error,
  context = 'meeting',
  onSubmit,
  onOpenCitation,
}: {
  answer?: GroundedAnswer;
  isPending?: boolean;
  error?: Error | null;
  context?: 'meeting' | 'group';
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
    <section
      aria-busy={isPending}
      aria-label={context === 'meeting' ? 'Trợ lý cuộc họp' : 'Trợ lý nhóm'}
      className="ai-surface ai-chat-panel"
    >
      <PanelHeader
        aside={
          <span className="ai-trust-label">
            <span />
            Nguồn trong nhóm
          </span>
        }
        description={
          context === 'meeting'
            ? 'Hỏi từ tài liệu, bản ghi và biên bản mà bạn được phép truy cập.'
            : 'Hỏi từ tài liệu, bản ghi và biên bản đã duyệt trong nhóm hiện tại.'
        }
        eyebrow={context === 'meeting' ? 'Meeting copilot' : 'Group copilot'}
        icon="message"
        title={context === 'meeting' ? 'Nối lại mạch cuộc họp' : 'Đối chiếu kiến thức nhóm'}
      />
      <form className="ai-composer" onSubmit={submit}>
        <label htmlFor="ai-question">Bạn muốn làm rõ điều gì?</label>
        <div className="ai-composer__field">
          <textarea
            id="ai-question"
            value={question}
            maxLength={4_000}
            placeholder="Ví dụ: Nhóm đã chốt phương án triển khai nào?"
            onChange={(event) => setQuestion(event.target.value)}
          />
          <span className="ai-character-count">
            {question.length.toLocaleString('vi-VN')} / 4.000
          </span>
        </div>
        <div className="ai-composer__actions">
          <button
            className="ai-button ai-button--primary"
            type="submit"
            disabled={isPending || !question.trim()}
          >
            {isPending ? (
              <>
                <span aria-hidden="true" className="ai-button-spinner" />
                Đang đối chiếu
              </>
            ) : (
              <>
                <AIIcon name="spark" size={17} />
                Hỏi CampusMeet
              </>
            )}
          </button>
          {context === 'meeting' && (
            <button
              className="ai-button ai-button--secondary"
              type="button"
              disabled={isPending}
              onClick={() =>
                onSubmit({
                  question: 'Tóm tắt phần nội dung cuộc họp đã diễn ra trước khi tôi tham gia.',
                  intent: 'LATE_JOIN_SUMMARY',
                })
              }
            >
              <AIIcon name="clock" size={17} />
              Tóm tắt phần đã lỡ
            </button>
          )}
        </div>
      </form>
      {isPending && <AIJobState isLoading />}
      {error && <AIJobState error={error} />}
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
    <form
      aria-busy={isPending}
      aria-label="Tìm kiếm kiến thức nhóm"
      className="ai-surface ai-group-search"
      onSubmit={submit}
    >
      <PanelHeader
        aside={<span className="ai-meeting-count">{meetingOptions.length} cuộc họp</span>}
        description="Đối chiếu quyết định và nội dung đã duyệt, luôn giới hạn trong nhóm này."
        eyebrow="Group knowledge"
        icon="search"
        title="Tìm trong tài liệu của nhóm"
      />
      <div className="ai-field">
        <label htmlFor="ai-group-question">Câu hỏi cần đối chiếu</label>
        <div className="ai-search-input">
          <AIIcon name="search" size={19} />
          <input
            id="ai-group-question"
            value={question}
            maxLength={4_000}
            placeholder="Tìm quyết định, công việc hoặc chủ đề đã bàn…"
            onChange={(event) => setQuestion(event.target.value)}
          />
        </div>
      </div>
      <fieldset className="ai-scope-picker">
        <legend>Phạm vi tìm kiếm</legend>
        <label>
          <input
            checked={scope === 'SELECTED_MEETINGS'}
            name="ai-search-scope"
            type="radio"
            value="SELECTED_MEETINGS"
            onChange={() => setScope('SELECTED_MEETINGS')}
          />
          <span>
            <strong>Cuộc họp đã chọn</strong>
            <small>So sánh một tập cuộc họp cụ thể</small>
          </span>
        </label>
        <label>
          <input
            checked={scope === 'WHOLE_GROUP'}
            name="ai-search-scope"
            type="radio"
            value="WHOLE_GROUP"
            onChange={() => setScope('WHOLE_GROUP')}
          />
          <span>
            <strong>Toàn bộ nhóm</strong>
            <small>Dùng mọi nguồn đã duyệt trong nhóm</small>
          </span>
        </label>
      </fieldset>
      {scope === 'SELECTED_MEETINGS' && (
        <fieldset className="ai-meeting-picker">
          <legend>Chọn cuộc họp</legend>
          {meetingOptions.length ? (
            <div className="ai-meeting-picker__grid">
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
                  <span className="ai-checkbox-mark">
                    <AIIcon name="check" size={14} />
                  </span>
                  <span>{meeting.title}</span>
                </label>
              ))}
            </div>
          ) : (
            <p className="ai-inline-empty">Chưa có cuộc họp đã duyệt để tìm kiếm.</p>
          )}
        </fieldset>
      )}
      <div className="ai-form-footer">
        <span>
          {isPending
            ? 'Đang kiểm tra nguồn trong phạm vi đã chọn'
            : scope === 'WHOLE_GROUP'
              ? 'Chỉ truy xuất nguồn trong nhóm hiện tại'
              : `${meetingIds.length} cuộc họp được chọn`}
        </span>
        <button
          className="ai-button ai-button--primary"
          type="submit"
          disabled={
            isPending || !question.trim() || (scope === 'SELECTED_MEETINGS' && !meetingIds.length)
          }
        >
          {isPending ? (
            <>
              <span aria-hidden="true" className="ai-button-spinner" />
              Đang tìm
            </>
          ) : (
            <>
              <AIIcon name="search" size={17} />
              Tìm trong nguồn
            </>
          )}
        </button>
      </div>
    </form>
  );
}

const GroundedList = ({
  title,
  items,
  tone,
}: {
  title: string;
  items: MinutesDraft['topics'];
  tone: 'neutral' | 'decision' | 'action';
}) => (
  <section className={`ai-minutes-section ai-minutes-section--${tone}`}>
    <header>
      <h4>{title}</h4>
      <span>{items.length}</span>
    </header>
    {items.length ? (
      <ul>
        {items.map((item, index) => (
          <li key={`${title}-${index}`}>
            <span>{item.content}</span>
            <small>{item.citations.length} nguồn</small>
          </li>
        ))}
      </ul>
    ) : (
      <p>Không có nội dung được ghi nhận.</p>
    )}
  </section>
);

export function MinutesDraftPreview({ draft }: { draft: MinutesDraft }) {
  return (
    <article className="ai-surface ai-minutes-draft">
      <PanelHeader
        aside={<span className="ai-review-label">Chờ duyệt</span>}
        description="Chỉ ghi lại nội dung đã được nêu; bạn vẫn là người quyết định bản cuối."
        eyebrow="Meeting record"
        icon="document"
        title="Biên bản nháp"
      />
      <section className="ai-minutes-summary">
        <span className="ai-eyebrow">Tóm tắt cuộc họp</span>
        <p>{draft.summary}</p>
      </section>
      <div className="ai-minutes-grid">
        <GroundedList title="Chủ đề" items={draft.topics} tone="neutral" />
        <GroundedList title="Quyết định" items={draft.decisions} tone="decision" />
        <GroundedList title="Việc đã nêu" items={draft.actionItems} tone="action" />
      </div>
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
  assigneeOptions = [],
  onComplete,
}: {
  proposal: TaskProposal;
  assigneeOptions?: Array<{ userId: string; displayName: string }>;
  onComplete: (fields: CompletedTaskProposalFields) => void;
}) {
  const assigneeInputId = useId();
  const priorityInputId = useId();
  const [assigneeId, setAssigneeId] = useState(proposal.assigneeId ?? '');
  const [priority, setPriority] = useState<TaskProposal['priority']>(proposal.priority);
  const hasMissingFields = !assigneeId.trim() || !priority;
  return (
    <article className="ai-surface ai-task-proposal">
      <header className="ai-proposal-header">
        <span className="ai-panel-header__mark">
          <AIIcon name="tasks" size={21} />
        </span>
        <div>
          <span className="ai-eyebrow">Đề xuất từ cuộc họp</span>
          <h4>{proposal.title}</h4>
        </div>
        <span className="ai-review-label">Cần xác nhận</span>
      </header>
      {proposal.description && <p className="ai-proposal-description">{proposal.description}</p>}
      {hasMissingFields && (
        <div className="ai-proposal-note">
          <AIIcon name="warning" size={17} />
          Bổ sung trường bắt buộc trước khi chuyển sang bước xác nhận tạo công việc.
        </div>
      )}
      <div className="ai-proposal-fields">
        <label htmlFor={assigneeInputId}>
          Người phụ trách
          <select
            id={assigneeInputId}
            value={assigneeId}
            onChange={(event) => setAssigneeId(event.target.value)}
          >
            <option value="">Chọn thành viên</option>
            {assigneeOptions.map((assignee) => (
              <option key={assignee.userId} value={assignee.userId}>
                {assignee.displayName}
              </option>
            ))}
            {assigneeId && !assigneeOptions.some((assignee) => assignee.userId === assigneeId) && (
              <option value={assigneeId}>{assigneeId}</option>
            )}
          </select>
        </label>
        <label htmlFor={priorityInputId}>
          Mức ưu tiên
          <select
            id={priorityInputId}
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
      </div>
      <div className="ai-form-footer">
        <span>AI không tự tạo công việc khi chưa có xác nhận.</span>
        <button
          className="ai-button ai-button--primary"
          type="button"
          disabled={hasMissingFields}
          onClick={() =>
            priority &&
            onComplete({ proposalId: proposal.proposalId, assigneeId: assigneeId.trim(), priority })
          }
        >
          Hoàn tất thông tin
          <AIIcon name="arrow" size={16} />
        </button>
      </div>
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
    return (
      <div className="ai-feedback ai-feedback--error" role="alert">
        <span className="ai-feedback__icon">
          <AIIcon name="warning" />
        </span>
        <div>
          <strong>Phân tích dành cho Quản trị viên nhóm</strong>
          <p>Tài khoản hiện tại không có quyền xem nội dung này.</p>
        </div>
      </div>
    );
  if (!analysis)
    return (
      <div className="ai-feedback ai-feedback--empty" role="status">
        <span className="ai-feedback__icon">
          <AIIcon name="tasks" />
        </span>
        <div>
          <strong>Chưa có phân tích tiến độ</strong>
          <p>Chạy phân tích sau khi nhóm đã có dữ liệu công việc.</p>
        </div>
      </div>
    );
  return (
    <article className="ai-surface ai-progress-analysis">
      <PanelHeader
        aside={
          <time dateTime={analysis.generatedAt}>
            {new Intl.DateTimeFormat('vi-VN', {
              day: '2-digit',
              month: '2-digit',
              year: 'numeric',
            }).format(new Date(analysis.generatedAt))}
          </time>
        }
        description="Diễn giải từ số liệu công việc trong nhóm, không chấm điểm thành viên."
        eyebrow="Group pulse"
        icon="tasks"
        title="Tiến độ nhóm"
      />
      <p className="ai-progress-summary">{analysis.summary}</p>
      <div className="ai-progress-grid">
        <section className="ai-progress-list ai-progress-list--observation">
          <header>
            <AIIcon name="check" size={18} />
            <h4>Quan sát</h4>
            <span>{analysis.observations.length}</span>
          </header>
          {analysis.observations.length ? (
            <ul>
              {analysis.observations.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : (
            <p>Chưa có quan sát.</p>
          )}
        </section>
        <section className="ai-progress-list ai-progress-list--risk">
          <header>
            <AIIcon name="warning" size={18} />
            <h4>Rủi ro cần chú ý</h4>
            <span>{analysis.risks.length}</span>
          </header>
          {analysis.risks.length ? (
            <ul>
              {analysis.risks.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : (
            <p>Chưa ghi nhận rủi ro.</p>
          )}
        </section>
      </div>
    </article>
  );
}
