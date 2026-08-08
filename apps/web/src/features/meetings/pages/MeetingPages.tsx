import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Priority,
  type ActionItem,
  type Attachment,
  type ConvertActionItemToTaskRequest,
  type CreateMeetingRequest,
  type GroupDetails,
  type Meeting,
  type MeetingMinutes,
  type MeetingTimelineResponse,
  type UpdateMeetingMinutesRequest,
  type UploadAttachmentRequest,
} from '@campusmeet/shared';
import { useAuth } from '../../../auth/AuthProvider';
import { FeaturePage } from '../../../components/FeaturePage';
import { environment } from '../../../config/environment';
import { ApiClientError } from '../../../lib/api-client';
import { MeetingAIWorkspace } from '../../ai';
import { getGroup } from '../../groups/service';
import {
  cancelMeeting,
  convertActionItemToTask,
  createMeeting,
  getMeeting,
  getMeetingMinutes,
  getMeetings,
  retryGoogleMeetingSync,
  updateMeeting,
  updateMeetingMinutes,
} from '../service';
import {
  completeAttachmentUpload,
  createAttachmentUploadTarget,
  getAttachmentDownloadTarget,
  getMeetingAttachments,
} from '../attachments.service';
import './MeetingPages.css';

const statusLabel: Record<string, string> = {
  DRAFT: 'Bản nháp',
  SCHEDULED: 'Đã lên lịch',
  READY: 'Sẵn sàng',
  CANCELLED: 'Đã hủy',
  COMPLETED: 'Đã hoàn thành',
  INTEGRATION_PENDING: 'Đang đồng bộ',
};

const meetingErrorMessage = (error: Error, context: 'create' | 'detail' | 'update' | 'cancel') => {
  if (!(error instanceof ApiClientError)) return error.message;
  if (error.status === 403) return 'Bạn không có quyền thực hiện thao tác này với cuộc họp.';
  if (error.status === 404)
    return context === 'create'
      ? 'Nhóm không còn tồn tại hoặc bạn không thể truy cập nhóm này.'
      : 'Cuộc họp không tồn tại hoặc bạn không thể truy cập.';
  if (error.status === 400 || error.status === 422)
    return 'Thông tin cuộc họp chưa hợp lệ. Vui lòng kiểm tra các trường và thử lại.';
  if (error.status >= 500)
    return 'CampusMeet đang tạm thời gặp sự cố. Dữ liệu của bạn vẫn được giữ, vui lòng thử lại.';
  return error.message;
};

const timeOptions = Array.from({ length: 96 }, (_, index) => {
  const hours = Math.floor(index / 4)
    .toString()
    .padStart(2, '0');
  const minutes = ((index % 4) * 15).toString().padStart(2, '0');
  return `${hours}:${minutes}`;
});

const formatDate = (value: string) =>
  new Intl.DateTimeFormat('vi-VN', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));

const toLocalInput = (value: string) => {
  const date = new Date(value);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
};

const toLocalDateInput = (value: string) => toLocalInput(value).slice(0, 10);

const endOfLocalDay = (value: string) => new Date(`${value}T23:59:59`).toISOString();

const defaultSchedule = () => {
  const start = new Date();
  start.setSeconds(0, 0);
  start.setMinutes(Math.ceil((start.getMinutes() + 1) / 15) * 15);
  if (start.getHours() === 0 || start.getHours() >= 23) {
    start.setDate(start.getDate() + 1);
    start.setHours(9, 0, 0, 0);
  }
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  return { start: toLocalInput(start.toISOString()), end: toLocalInput(end.toISOString()) };
};

const memberLabel = (group: GroupDetails | undefined, userId: string) => {
  const member = group?.members.find(({ membership }) => membership.userId === userId);
  return member?.user?.displayName || member?.user?.email || userId;
};

type AgendaDraft = {
  localId: string;
  id?: string;
  title: string;
  description: string;
};

let agendaDraftSequence = 0;
const createAgendaDraft = (item?: Meeting['agenda'][number]): AgendaDraft => ({
  localId: item?.id ?? `agenda-draft-${++agendaDraftSequence}`,
  ...(item?.id ? { id: item.id } : {}),
  title: item?.title ?? '',
  description: item?.description ?? '',
});

const agendaPresets = [
  {
    id: 'weekly-progress',
    label: 'Họp tiến độ tuần',
    items: [
      'Mở đầu và cập nhật nhanh',
      'Kết quả công việc tuần qua',
      'Nội dung cần phối hợp',
      'Kế hoạch tuần tới',
      'Kết luận và phân công',
    ],
  },
  {
    id: 'kickoff',
    label: 'Họp khởi động dự án',
    items: [
      'Mục tiêu và phạm vi dự án',
      'Vai trò và trách nhiệm',
      'Kế hoạch và các mốc chính',
      'Rủi ro ban đầu',
      'Việc cần làm tiếp theo',
    ],
  },
  {
    id: 'sprint-review',
    label: 'Họp đánh giá chu kỳ',
    items: [
      'Mục tiêu của chu kỳ',
      'Kết quả đã hoàn thành',
      'Trình bày kết quả',
      'Ý kiến phản hồi',
      'Công việc chuyển tiếp',
    ],
  },
  {
    id: 'retrospective',
    label: 'Họp nhìn lại',
    items: [
      'Điều đã làm tốt',
      'Điều cần cải thiện',
      'Giải pháp đề xuất',
      'Hành động cho chu kỳ tới',
    ],
  },
  {
    id: 'decision',
    label: 'Họp ra quyết định',
    items: [
      'Bối cảnh',
      'Các phương án',
      'Tiêu chí đánh giá',
      'Quyết định',
      'Người phụ trách và hạn',
    ],
  },
  { id: 'custom', label: 'Tạo chương trình riêng', items: [] },
] as const;

type AgendaPresetId = (typeof agendaPresets)[number]['id'];

const agendaFromPreset = (presetId: AgendaPresetId) =>
  agendaPresets
    .find(({ id }) => id === presetId)!
    .items.map((title) => ({ ...createAgendaDraft(), title }));

type MinutesDraft = Omit<UpdateMeetingMinutesRequest, 'expectedVersion'>;

const minutesDraft = (minutes?: MeetingMinutes): MinutesDraft => ({
  summary: minutes?.summary ?? '',
  discussion: minutes?.discussion ?? '',
  decisions: minutes?.decisions.map(({ id, content }) => ({ id, content })) ?? [],
  actionItems:
    minutes?.actionItems.map(({ id, content, assigneeId, dueAt }) => ({
      id,
      content,
      ...(assigneeId ? { assigneeId } : {}),
      ...(dueAt ? { dueAt } : {}),
    })) ?? [],
});

const conversionErrorMessage = (error: Error) => {
  if (!(error instanceof ApiClientError)) return error.message;
  if (error.status === 400) return 'Thông tin tạo công việc chưa hợp lệ.';
  if (error.status === 403) return 'Bạn không còn quyền Quản trị viên để tạo công việc.';
  if (error.status === 404)
    return 'Việc cần thực hiện không còn trong phiên bản biên bản mới nhất.';
  if (error.status === 409)
    return 'Biên bản đã thay đổi hoặc mục này vừa được chuyển thành công việc ở nơi khác.';
  if (error.status === 422) return error.message;
  return error.status >= 500
    ? 'CampusMeet đang tạm thời gặp sự cố. Vui lòng thử lại.'
    : error.message;
};

function MinutesReadView({ minutes, group }: { minutes: MeetingMinutes; group?: GroupDetails }) {
  return (
    <div className="minutes-read-view">
      <div className="minutes-read-heading">
        <div>
          <strong>Kết quả cuộc họp</strong>
          <span>Phiên bản {minutes.version}</span>
        </div>
        <span className="minutes-saved-state">Đã lưu</span>
      </div>
      <section className="minutes-summary-block">
        <h3>Tóm tắt</h3>
        <p>{minutes.summary}</p>
      </section>
      {minutes.discussion && (
        <details className="minutes-discussion-read">
          <summary>Nội dung thảo luận</summary>
          <p>{minutes.discussion}</p>
        </details>
      )}
      <section className="minutes-result-section">
        <h3>Quyết định</h3>
        {minutes.decisions.length ? (
          <ul className="minutes-result-list">
            {minutes.decisions.map((item, index) => (
              <li key={item.id || `decision-${index}`}>
                <span aria-hidden="true">✓</span>
                <span>{item.content}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p>Chưa ghi nhận quyết định.</p>
        )}
      </section>
      <section className="minutes-result-section">
        <h3>Việc sau cuộc họp</h3>
        {minutes.actionItems.length ? (
          <ul className="minutes-action-summary-list">
            {minutes.actionItems.map((item, index) => (
              <li key={item.id || `action-${index}`}>
                <div>
                  <strong>{item.content}</strong>
                  <span>
                    {item.assigneeId
                      ? memberLabel(group, item.assigneeId)
                      : 'Chưa chọn người phụ trách'}
                    {item.dueAt ? ` · Hạn ${formatDate(item.dueAt)}` : ' · Chưa có hạn'}
                  </span>
                </div>
                <span className={item.taskId ? 'minutes-tracked' : 'minutes-not-tracked'}>
                  {item.taskId ? 'Đang theo dõi' : 'Chưa tạo công việc'}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p>Chưa ghi nhận việc cần thực hiện.</p>
        )}
      </section>
    </div>
  );
}

function ActionItemTaskConversionPanel({
  meetingId,
  minutes,
  group,
  currentUserId,
  disabled,
  queryKey,
  onConverted,
}: {
  meetingId: string;
  minutes: MeetingMinutes;
  group: GroupDetails;
  currentUserId: string;
  disabled: boolean;
  queryKey: readonly unknown[];
  onConverted: (minutes: MeetingMinutes) => void;
}) {
  const queryClient = useQueryClient();
  const [selectedActionId, setSelectedActionId] = useState('');
  const [priority, setPriority] = useState<Priority>(Priority.MEDIUM);
  const [assigneeId, setAssigneeId] = useState('');
  const [title, setTitle] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const submittingRef = useRef(false);
  const activeMembers = group.members.filter(({ membership }) => membership.active);

  useEffect(() => {
    if (
      selectedActionId &&
      !minutes.actionItems.some((actionItem) => actionItem.id === selectedActionId)
    ) {
      setSelectedActionId('');
      setPriority(Priority.MEDIUM);
      setAssigneeId('');
      setTitle('');
    }
  }, [minutes.actionItems, selectedActionId]);

  const mutation = useMutation({
    mutationFn: ({
      actionItem,
      input,
    }: {
      actionItem: ActionItem;
      input: ConvertActionItemToTaskRequest;
    }) => convertActionItemToTask(meetingId, actionItem.id, input),
    onMutate: () => {
      setErrorMessage('');
      setSuccessMessage('');
    },
    onSuccess: async ({ task, minutes: authoritativeMinutes }) => {
      queryClient.setQueryData(queryKey, authoritativeMinutes);
      onConverted(authoritativeMinutes);
      setSelectedActionId('');
      setPriority(Priority.MEDIUM);
      setAssigneeId('');
      setTitle('');
      setErrorMessage('');
      setSuccessMessage('Đã đưa việc này vào danh sách công việc.');
      if (task.assigneeId === currentUserId) {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['tasks'] }),
          queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
        ]);
      }
    },
    onError: async (error) => {
      setErrorMessage(conversionErrorMessage(error));
      if (error instanceof ApiClientError && error.status === 403) {
        await queryClient.invalidateQueries({ queryKey: ['groups', minutes.groupId] });
      } else if (
        error instanceof ApiClientError &&
        (error.status === 404 || error.status === 409)
      ) {
        await queryClient.invalidateQueries({ queryKey });
      }
    },
    onSettled: () => {
      submittingRef.current = false;
    },
  });

  const openForm = (actionItemId: string) => {
    if (disabled || mutation.isPending) return;
    setSelectedActionId(actionItemId);
    setPriority(Priority.MEDIUM);
    setAssigneeId('');
    setTitle('');
    setErrorMessage('');
    setSuccessMessage('');
  };

  const submit = (actionItem: ActionItem) => {
    if (disabled || submittingRef.current || mutation.isPending) return;
    const normalizedTitle = title.trim();
    const normalizedAssigneeId = assigneeId.trim();
    if (!actionItem.assigneeId && !normalizedAssigneeId) {
      setErrorMessage('Vui lòng chọn người phụ trách đang hoạt động.');
      return;
    }
    if (actionItem.content.length > 200 && !normalizedTitle) {
      setErrorMessage('Nội dung vượt quá 200 ký tự; vui lòng nhập tiêu đề ngắn gọn.');
      return;
    }
    const input: ConvertActionItemToTaskRequest = {
      expectedMinutesVersion: minutes.version,
      priority,
      ...(!actionItem.assigneeId ? { assigneeId: normalizedAssigneeId } : {}),
      ...(normalizedTitle ? { title: normalizedTitle } : {}),
    };
    submittingRef.current = true;
    mutation.mutate({ actionItem, input });
  };

  return (
    <section className="action-item-task-panel" aria-label="Theo dõi việc sau cuộc họp">
      <div>
        <h3>Theo dõi việc sau cuộc họp</h3>
        <p>
          Biên bản ghi lại cam kết. Đưa một mục vào danh sách công việc để người phụ trách cập nhật
          tiến độ và kết quả thực hiện.
        </p>
        {disabled && <p className="minutes-dirty">Hãy lưu biên bản trước khi tiếp tục.</p>}
      </div>
      <ul className="action-item-task-list">
        {minutes.actionItems.map((actionItem, index) => {
          const selected = selectedActionId === actionItem.id;
          return (
            <li
              key={actionItem.id || `persisted-action-${index}`}
              className="action-item-task-entry"
            >
              <div className="action-item-task-heading">
                <span>
                  <strong>{actionItem.content}</strong>
                  {actionItem.assigneeId && (
                    <small>Người phụ trách: {memberLabel(group, actionItem.assigneeId)}</small>
                  )}
                </span>
                {actionItem.taskId ? (
                  <span className="action-item-task-converted">Đang được theo dõi</span>
                ) : (
                  <button
                    type="button"
                    disabled={disabled || mutation.isPending}
                    onClick={() => openForm(actionItem.id)}
                  >
                    Đưa vào danh sách công việc
                  </button>
                )}
              </div>
              {selected && !actionItem.taskId && (
                <div className="action-item-task-form">
                  <label>
                    Mức ưu tiên
                    <select
                      aria-label={`Mức ưu tiên cho ${actionItem.content}`}
                      value={priority}
                      disabled={mutation.isPending}
                      onChange={(event) => setPriority(event.target.value as Priority)}
                    >
                      <option value={Priority.LOW}>Thấp</option>
                      <option value={Priority.MEDIUM}>Vừa</option>
                      <option value={Priority.HIGH}>Cao</option>
                    </select>
                  </label>
                  {!actionItem.assigneeId && (
                    <label>
                      Người phụ trách
                      <select
                        aria-label={`Người phụ trách công việc ${actionItem.content}`}
                        value={assigneeId}
                        disabled={mutation.isPending}
                        onChange={(event) => setAssigneeId(event.target.value)}
                        required
                      >
                        <option value="">Chọn người phụ trách</option>
                        {activeMembers.map(({ membership, user }) => (
                          <option key={membership.userId} value={membership.userId}>
                            {user?.displayName || user?.email || membership.userId}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <label>
                    Tiêu đề công việc{' '}
                    <span>
                      {actionItem.content.length > 200 ? '(bắt buộc)' : '(không bắt buộc)'}
                    </span>
                    <input
                      aria-label={`Tiêu đề công việc ${actionItem.content}`}
                      value={title}
                      disabled={mutation.isPending}
                      maxLength={200}
                      required={actionItem.content.length > 200}
                      onChange={(event) => setTitle(event.target.value)}
                    />
                  </label>
                  <div className="action-item-task-actions">
                    <button
                      type="button"
                      disabled={disabled || mutation.isPending}
                      onClick={() => submit(actionItem)}
                    >
                      {mutation.isPending ? 'Đang tạo…' : 'Xác nhận và giao việc'}
                    </button>
                    <button
                      type="button"
                      disabled={mutation.isPending}
                      onClick={() => {
                        setSelectedActionId('');
                        setErrorMessage('');
                      }}
                    >
                      Hủy
                    </button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {errorMessage && (
        <p className="error" role="alert">
          {errorMessage}
        </p>
      )}
      {successMessage && (
        <p className="minutes-success" role="status">
          {successMessage} <Link to="/app/tasks">Mở danh sách công việc</Link>
        </p>
      )}
    </section>
  );
}

function MinutesEditor({
  meetingId,
  initial,
  group,
  currentUserId,
  queryKey,
}: {
  meetingId: string;
  initial?: MeetingMinutes;
  group: GroupDetails;
  currentUserId: string;
  queryKey: readonly unknown[];
}) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(() => minutesDraft(initial));
  const [expectedVersion, setExpectedVersion] = useState(initial?.version ?? 0);
  const [isEditing, setIsEditing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState('');
  const [hasConflict, setHasConflict] = useState(false);
  const mutation = useMutation({
    mutationFn: () => updateMeetingMinutes(meetingId, { ...draft, expectedVersion }),
    onSuccess: async (minutes) => {
      setDraft(minutesDraft(minutes));
      setExpectedVersion(minutes.version);
      setDirty(false);
      setHasConflict(false);
      setMessage(`Đã lưu phiên bản ${minutes.version}.`);
      setIsEditing(false);
      queryClient.setQueryData(queryKey, minutes);
      await queryClient.invalidateQueries({ queryKey });
    },
    onError: async (error) => {
      if (error instanceof ApiClientError && error.status === 409) {
        setHasConflict(true);
        setMessage('Biên bản đã thay đổi. Bản nháp của bạn vẫn được giữ để đối chiếu.');
        await queryClient.invalidateQueries({ queryKey });
        return;
      }
      if (error instanceof ApiClientError && error.status === 403) {
        setMessage('Bạn không có quyền ghi biên bản này.');
        return;
      }
      if (error instanceof ApiClientError && error.status === 422) {
        setMessage(error.message);
        return;
      }
      setMessage(error instanceof Error ? error.message : 'Không thể lưu biên bản.');
    },
  });

  const changeDraft = (next: MinutesDraft) => {
    setDraft(next);
    setDirty(true);
    setMessage('');
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setMessage('');
    if (!mutation.isPending) mutation.mutate();
  };

  const beginEditing = () => {
    setDraft(minutesDraft(initial));
    setExpectedVersion(initial?.version ?? 0);
    setDirty(false);
    setHasConflict(false);
    setMessage('');
    setIsEditing(true);
  };

  const stopEditing = () => {
    if (dirty && !window.confirm('Bỏ các thay đổi chưa lưu trong biên bản?')) return;
    setDraft(minutesDraft(initial));
    setExpectedVersion(initial?.version ?? 0);
    setDirty(false);
    setHasConflict(false);
    setMessage('');
    setIsEditing(false);
  };

  const applyConvertedMinutes = (minutes: MeetingMinutes) => {
    setDraft(minutesDraft(minutes));
    setExpectedVersion(minutes.version);
    setDirty(false);
    setHasConflict(false);
    setMessage('');
  };

  if (!isEditing) {
    return (
      <div className="minutes-workspace">
        <ol className="minutes-workflow" aria-label="Quy trình sau cuộc họp">
          <li>
            <span>1</span>
            <div>
              <strong>Ghi lại kết quả</strong>
              <small>Tóm tắt nội dung và các quyết định đã thống nhất.</small>
            </div>
          </li>
          <li>
            <span>2</span>
            <div>
              <strong>Chốt việc cần làm</strong>
              <small>Ghi rõ người phụ trách và hạn hoàn thành.</small>
            </div>
          </li>
          <li>
            <span>3</span>
            <div>
              <strong>Theo dõi tiến độ</strong>
              <small>Đưa từng mục đã lưu vào danh sách công việc.</small>
            </div>
          </li>
        </ol>
        {message && (
          <p className="minutes-success" role="status">
            {message}
          </p>
        )}
        {initial ? (
          <>
            <MinutesReadView minutes={initial} group={group} />
            <button
              type="button"
              className="button-secondary minutes-edit-button"
              onClick={beginEditing}
            >
              Chỉnh sửa biên bản
            </button>
            {initial.actionItems.length > 0 && (
              <ActionItemTaskConversionPanel
                meetingId={meetingId}
                minutes={initial}
                group={group}
                currentUserId={currentUserId}
                disabled={false}
                queryKey={queryKey}
                onConverted={applyConvertedMinutes}
              />
            )}
          </>
        ) : (
          <div className="minutes-empty minutes-empty-guided">
            <div>
              <strong>Chưa có biên bản</strong>
              <p>
                Bắt đầu bằng một bản tóm tắt ngắn; quyết định và việc cần làm có thể bổ sung sau.
              </p>
            </div>
            <button type="button" onClick={beginEditing}>
              Soạn biên bản
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <form className="minutes-editor" onSubmit={submit}>
      <div className="minutes-editor-heading">
        <div>
          <strong>{initial ? 'Chỉnh sửa biên bản' : 'Soạn biên bản'}</strong>
          <span>Phiên bản hiện tại: {expectedVersion}</span>
        </div>
        <div>
          {dirty && <span className="minutes-dirty">Chưa lưu</span>}
          <button type="button" className="button-quiet" onClick={stopEditing}>
            Đóng
          </button>
        </div>
      </div>
      <section className="minutes-form-section">
        <div className="minutes-form-section-heading">
          <span>1</span>
          <div>
            <h3>Kết quả cuộc họp</h3>
            <p>Ghi ngắn gọn điều quan trọng để thành viên vắng mặt vẫn nắm được kết quả.</p>
          </div>
        </div>
        <label>
          Tóm tắt <span className="field-required">Bắt buộc</span>
          <textarea
            value={draft.summary}
            onChange={(event) => changeDraft({ ...draft, summary: event.target.value })}
            minLength={1}
            maxLength={2000}
            rows={3}
            placeholder="Ví dụ: Nhóm đã thống nhất phạm vi sprint và thời hạn bàn giao bản demo."
            required
          />
        </label>
        <details className="minutes-discussion-editor">
          <summary>
            Thêm nội dung thảo luận <span>(không bắt buộc)</span>
          </summary>
          <label>
            Diễn biến hoặc ý kiến cần lưu lại
            <textarea
              value={draft.discussion}
              onChange={(event) => changeDraft({ ...draft, discussion: event.target.value })}
              maxLength={10000}
              rows={5}
              placeholder="Ghi các phương án đã trao đổi hoặc bối cảnh cần tham khảo sau này."
            />
          </label>
        </details>
      </section>
      <fieldset className="minutes-form-section">
        <legend className="minutes-form-section-heading">
          <span>2</span>
          <span>
            <strong>Quyết định</strong>
            <small>Những nội dung cả nhóm đã thống nhất.</small>
          </span>
        </legend>
        {draft.decisions.map((decision, index) => (
          <div className="minutes-row" key={decision.id ?? `decision-new-${index}`}>
            <input
              aria-label={`Quyết định ${index + 1}`}
              placeholder="Nhập quyết định đã thống nhất"
              value={decision.content}
              onChange={(event) =>
                changeDraft({
                  ...draft,
                  decisions: draft.decisions.map((item, itemIndex) =>
                    itemIndex === index ? { ...item, content: event.target.value } : item,
                  ),
                })
              }
              maxLength={1000}
              required
            />
            <button
              type="button"
              disabled={mutation.isPending}
              onClick={() =>
                changeDraft({
                  ...draft,
                  decisions: draft.decisions.filter((_, itemIndex) => itemIndex !== index),
                })
              }
            >
              Xóa
            </button>
          </div>
        ))}
        {draft.decisions.length === 0 && (
          <p className="minutes-inline-empty">Chưa có quyết định.</p>
        )}
        <button
          type="button"
          className="button-secondary minutes-add-button"
          disabled={mutation.isPending || draft.decisions.length >= 50}
          onClick={() =>
            changeDraft({ ...draft, decisions: [...draft.decisions, { content: '' }] })
          }
        >
          Thêm quyết định
        </button>
      </fieldset>
      <fieldset className="minutes-form-section">
        <legend className="minutes-form-section-heading">
          <span>3</span>
          <span>
            <strong>Việc sau cuộc họp</strong>
            <small>Mỗi mục nên có người phụ trách và một ngày hoàn thành rõ ràng.</small>
          </span>
        </legend>
        {draft.actionItems.map((action, index) => (
          <div className="minutes-action-row" key={action.id ?? `action-new-${index}`}>
            <label className="minutes-action-content">
              Nội dung
              <input
                aria-label={`Việc cần thực hiện ${index + 1}`}
                value={action.content}
                placeholder="Ví dụ: Hoàn thiện bản demo đăng nhập"
                onChange={(event) =>
                  changeDraft({
                    ...draft,
                    actionItems: draft.actionItems.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, content: event.target.value } : item,
                    ),
                  })
                }
                maxLength={1000}
                required
              />
            </label>
            <label>
              Người phụ trách
              <select
                aria-label={`Người phụ trách ${index + 1}`}
                value={action.assigneeId ?? ''}
                onChange={(event) =>
                  changeDraft({
                    ...draft,
                    actionItems: draft.actionItems.map((item, itemIndex) =>
                      itemIndex === index
                        ? {
                            ...(item.id ? { id: item.id } : {}),
                            content: item.content,
                            ...(event.target.value ? { assigneeId: event.target.value } : {}),
                            ...(item.dueAt ? { dueAt: item.dueAt } : {}),
                          }
                        : item,
                    ),
                  })
                }
              >
                <option value="">Chọn người phụ trách</option>
                {group.members
                  .filter(({ membership }) => membership.active)
                  .map(({ membership, user }) => (
                    <option key={membership.userId} value={membership.userId}>
                      {user?.displayName || user?.email || membership.userId}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Hạn hoàn thành
              <input
                aria-label={`Hạn hoàn thành ${index + 1}`}
                type="date"
                value={action.dueAt ? toLocalDateInput(action.dueAt) : ''}
                onChange={(event) =>
                  changeDraft({
                    ...draft,
                    actionItems: draft.actionItems.map((item, itemIndex) =>
                      itemIndex === index
                        ? {
                            ...(item.id ? { id: item.id } : {}),
                            content: item.content,
                            ...(item.assigneeId ? { assigneeId: item.assigneeId } : {}),
                            ...(event.target.value
                              ? { dueAt: endOfLocalDay(event.target.value) }
                              : {}),
                          }
                        : item,
                    ),
                  })
                }
              />
            </label>
            <button
              type="button"
              className="button-quiet minutes-action-remove"
              disabled={mutation.isPending}
              onClick={() =>
                changeDraft({
                  ...draft,
                  actionItems: draft.actionItems.filter((_, itemIndex) => itemIndex !== index),
                })
              }
            >
              Xóa
            </button>
          </div>
        ))}
        {draft.actionItems.length === 0 && (
          <p className="minutes-inline-empty">Chưa có việc cần theo dõi sau cuộc họp.</p>
        )}
        <button
          type="button"
          className="button-secondary minutes-add-button"
          disabled={mutation.isPending || draft.actionItems.length >= 100}
          onClick={() =>
            changeDraft({ ...draft, actionItems: [...draft.actionItems, { content: '' }] })
          }
        >
          Thêm việc sau cuộc họp
        </button>
      </fieldset>
      {message && (
        <p className={mutation.isError ? 'error' : 'minutes-success'} role="status">
          {message}
        </p>
      )}
      {hasConflict && initial && initial.version !== expectedVersion && (
        <button
          type="button"
          onClick={() => {
            setExpectedVersion(initial.version);
            setHasConflict(false);
            setMessage(`Đang đối chiếu với phiên bản ${initial.version}; bản nháp vẫn được giữ.`);
          }}
        >
          Dùng phiên bản mới làm mốc
        </button>
      )}
      <div className="minutes-form-actions">
        <button type="button" className="button-secondary" onClick={stopEditing}>
          Hủy
        </button>
        <button type="submit" disabled={mutation.isPending || !dirty}>
          {mutation.isPending ? 'Đang lưu…' : initial ? 'Lưu thay đổi' : 'Lưu biên bản'}
        </button>
      </div>
    </form>
  );
}

const supportedContentTypes = [
  'text/plain',
  'text/markdown',
  'text/csv',
  'text/tab-separated-values',
  'application/json',
  'application/x-ndjson',
  'text/html',
  'application/xhtml+xml',
  'application/xml',
  'text/yaml',
  'text/calendar',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.oasis.opendocument.presentation',
  'application/vnd.oasis.opendocument.spreadsheet',
  'audio/mpeg',
  'audio/wav',
  'audio/webm',
  'audio/mp4',
] as const;

const documentContentTypes = supportedContentTypes.filter(
  (contentType) => !contentType.startsWith('audio/'),
);

const attachmentStatusLabels: Record<Attachment['status'], string> = {
  PENDING_UPLOAD: 'Đang tải lên',
  UPLOADED: 'Đang xử lý',
  READY: 'Sẵn sàng',
  REJECTED: 'Xử lý thất bại',
  EXPIRED: 'Đã hết hạn',
};

const attachmentTypeLabels: Record<string, string> = {
  'text/plain': 'Văn bản',
  'text/markdown': 'Markdown',
  'text/csv': 'CSV',
  'text/tab-separated-values': 'TSV',
  'application/json': 'JSON',
  'application/x-ndjson': 'NDJSON',
  'text/html': 'HTML',
  'application/xhtml+xml': 'XHTML',
  'application/xml': 'XML',
  'text/yaml': 'YAML',
  'text/calendar': 'Lịch iCalendar',
  'application/pdf': 'PDF',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Word',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'PowerPoint',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'Excel',
  'application/vnd.oasis.opendocument.text': 'Tài liệu OpenDocument',
  'application/vnd.oasis.opendocument.presentation': 'Trình chiếu OpenDocument',
  'application/vnd.oasis.opendocument.spreadsheet': 'Bảng tính OpenDocument',
};

const googleSyncLabel: Record<string, string> = {
  NOT_REQUESTED: 'Chưa đồng bộ',
  PENDING: 'Đang đồng bộ',
  READY: 'Đã đồng bộ',
  SYNCED: 'Đã đồng bộ',
  FAILED: 'Đồng bộ thất bại',
  FAILED_RETRYABLE: 'Đồng bộ thất bại',
  ACTION_REQUIRED: 'Cần kết nối lại',
};

type SupportedContentType = (typeof supportedContentTypes)[number];

const maxAttachmentSizeBytes = 50 * 1024 * 1024;

const fileTypeByExtension: Record<string, SupportedContentType> = {
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.csv': 'text/csv',
  '.tsv': 'text/tab-separated-values',
  '.json': 'application/json',
  '.ndjson': 'application/x-ndjson',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.xhtml': 'application/xhtml+xml',
  '.xml': 'application/xml',
  '.yaml': 'text/yaml',
  '.yml': 'text/yaml',
  '.ics': 'text/calendar',
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.odt': 'application/vnd.oasis.opendocument.text',
  '.odp': 'application/vnd.oasis.opendocument.presentation',
  '.ods': 'application/vnd.oasis.opendocument.spreadsheet',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.webm': 'audio/webm',
  '.m4a': 'audio/mp4',
};

const inferContentType = (fileName: string) => {
  const extension = fileName.slice(fileName.lastIndexOf('.')).toLowerCase();
  return fileTypeByExtension[extension];
};

const toHex = (buffer: ArrayBuffer) =>
  [...new Uint8Array(buffer)].map((value) => value.toString(16).padStart(2, '0')).join('');

const checksumFile = async (file: File) => {
  const bytes = await file.arrayBuffer();
  return toHex(await crypto.subtle.digest('SHA-256', bytes));
};

function AttachmentListItem({
  attachment,
  onDownload,
  downloading,
}: {
  attachment: Attachment;
  onDownload: (attachmentId: string) => void;
  downloading: boolean;
}) {
  return (
    <li className="meeting-attachment-item">
      <div className="meeting-attachment-copy">
        <strong>{attachment.fileName}</strong>
        <small>
          {attachmentTypeLabels[attachment.contentType] ?? 'Tài liệu'} ·{' '}
          {(attachment.sizeBytes / (1024 * 1024)).toFixed(1)} MB
        </small>
      </div>
      <span className={`meeting-status meeting-status-${attachment.status.toLowerCase()}`}>
        {attachmentStatusLabels[attachment.status]}
      </span>
      <button
        type="button"
        className="button-quiet"
        onClick={() => onDownload(attachment.attachmentId)}
        disabled={downloading || attachment.status !== 'READY'}
      >
        {downloading
          ? 'Đang chuẩn bị…'
          : attachment.status === 'READY'
            ? 'Tải xuống'
            : 'Chưa sẵn sàng'}
      </button>
    </li>
  );
}

function MeetingAttachmentsPanel({ meeting }: { meeting: Meeting }) {
  const queryClient = useQueryClient();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const attachmentsQuery = useQuery({
    queryKey: ['meetings', meeting.id, 'attachments'],
    queryFn: () => getMeetingAttachments(meeting.id),
    enabled: Boolean(meeting.id),
    refetchInterval: (query) =>
      query.state.data?.some(
        (attachment) => attachment.status === 'PENDING_UPLOAD' || attachment.status === 'UPLOADED',
      )
        ? 3_000
        : false,
  });
  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const contentType = (file.type || inferContentType(file.name)) as
        SupportedContentType | undefined;
      if (
        !contentType ||
        !documentContentTypes.includes(contentType as (typeof documentContentTypes)[number])
      ) {
        throw new Error('Định dạng tệp này chưa được hỗ trợ.');
      }
      if (file.size > maxAttachmentSizeBytes) {
        throw new Error('Tệp vượt quá giới hạn 50 MB.');
      }
      const checksum = await checksumFile(file);
      const target = await createAttachmentUploadTarget(meeting.id, {
        meetingId: meeting.id,
        fileName: file.name,
        contentType,
        sizeBytes: file.size,
        checksum,
      } satisfies UploadAttachmentRequest);
      const response = await fetch(target.uploadUrl, {
        method: 'PUT',
        headers: {
          'content-type': contentType,
          'x-amz-meta-checksum': checksum,
        },
        body: file,
      });
      if (!response.ok) {
        throw new Error('Không thể tải tệp lên kho lưu trữ.');
      }
      return completeAttachmentUpload(meeting.id, target.attachment.attachmentId, {
        attachmentId: target.attachment.attachmentId,
        checksum,
      });
    },
    onSuccess: async () => {
      setSelectedFile(null);
      await queryClient.invalidateQueries({ queryKey: ['meetings', meeting.id, 'attachments'] });
    },
  });
  const downloadMutation = useMutation({
    mutationFn: async (attachmentId: string) => getAttachmentDownloadTarget(attachmentId),
    onSuccess: (target) => {
      window.open(target.downloadUrl, '_blank', 'noopener,noreferrer');
    },
  });

  const attachments = attachmentsQuery.data ?? [];

  return (
    <section className="app-panel meeting-attachment-panel">
      <span className="section-kicker">Tệp đính kèm</span>
      <h2>Tải tài liệu lên</h2>
      <p>
        Hỗ trợ PDF, Word, PowerPoint, Excel và các định dạng văn bản phổ biến. Tối đa 10 tài liệu,
        mỗi tài liệu không quá 50 MB.
      </p>
      <label className="meeting-upload-field">
        Chọn tài liệu
        <input
          type="file"
          accept={documentContentTypes.join(',')}
          onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
        />
      </label>
      {selectedFile && (
        <div className="meeting-upload-preview">
          <strong>{selectedFile.name}</strong>
          <small>{(selectedFile.size / (1024 * 1024)).toFixed(2)} MB</small>
        </div>
      )}
      <button
        type="button"
        disabled={!selectedFile || uploadMutation.isPending}
        onClick={() => {
          if (selectedFile) void uploadMutation.mutateAsync(selectedFile);
        }}
      >
        {uploadMutation.isPending ? 'Đang tải lên…' : 'Tải tài liệu lên'}
      </button>
      {uploadMutation.isError && (
        <p className="error" role="alert">
          {uploadMutation.error.message}
        </p>
      )}
      {downloadMutation.isError && (
        <p className="error" role="alert">
          Chưa thể tải tài liệu xuống. Vui lòng thử lại sau.
        </p>
      )}
      {attachmentsQuery.isPending ? (
        <div className="meeting-attachment-state" role="status">
          Đang tải danh sách tài liệu…
        </div>
      ) : attachmentsQuery.isError ? (
        <div className="meeting-attachment-state error" role="status">
          <strong>Không tải được danh sách tài liệu</strong>
          <button
            type="button"
            className="button-quiet"
            onClick={() => void attachmentsQuery.refetch()}
          >
            Thử lại tải tệp
          </button>
        </div>
      ) : attachments.length ? (
        <ul className="meeting-attachment-list">
          {attachments.map((attachment) => (
            <AttachmentListItem
              key={attachment.attachmentId}
              attachment={attachment}
              downloading={downloadMutation.isPending}
              onDownload={(attachmentId) => downloadMutation.mutate(attachmentId)}
            />
          ))}
        </ul>
      ) : (
        <div className="meeting-attachment-state">Chưa có tài liệu nào trong cuộc họp này.</div>
      )}
    </section>
  );
}

function MeetingForm({
  group,
  initial,
  submitLabel,
  pending,
  error,
  onSubmit,
}: {
  group: GroupDetails;
  initial?: Meeting;
  submitLabel: string;
  pending: boolean;
  error?: string;
  onSubmit: (input: CreateMeetingRequest) => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [schedule] = useState(() =>
    initial
      ? { start: toLocalInput(initial.startsAt), end: toLocalInput(initial.endsAt) }
      : defaultSchedule(),
  );
  const [meetingDate, setMeetingDate] = useState(schedule.start.slice(0, 10));
  const [startTime, setStartTime] = useState(schedule.start.slice(11));
  const [endTime, setEndTime] = useState(schedule.end.slice(11));
  const [timeError, setTimeError] = useState('');
  const [titleError, setTitleError] = useState('');
  const [descriptionError, setDescriptionError] = useState('');
  const [attendeeIds, setAttendeeIds] = useState(initial?.attendeeIds ?? []);
  const [agenda, setAgenda] = useState<AgendaDraft[]>(() =>
    [...(initial?.agenda ?? [])].sort((a, b) => a.order - b.order).map(createAgendaDraft),
  );
  const [agendaErrors, setAgendaErrors] = useState<Record<string, string>>({});
  const [agendaPreset, setAgendaPreset] = useState<AgendaPresetId>('weekly-progress');
  const [pendingAgendaPreset, setPendingAgendaPreset] = useState<AgendaPresetId | null>(null);

  const applyAgendaPreset = (presetId: AgendaPresetId) => {
    setAgenda(agendaFromPreset(presetId));
    setAgendaErrors({});
    setPendingAgendaPreset(null);
  };

  const requestAgendaPreset = () => {
    if (agenda.length) {
      setPendingAgendaPreset(agendaPreset);
      return;
    }
    applyAgendaPreset(agendaPreset);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const normalizedTitle = title.trim();
    if (normalizedTitle.length < 2) {
      setTitleError('Tiêu đề cần ít nhất 2 ký tự.');
      return;
    }
    if (description.trim().length > 2000) {
      setDescriptionError('Nội dung không được vượt quá 2000 ký tự.');
      return;
    }
    setTitleError('');
    setDescriptionError('');
    if (endTime <= startTime) {
      setTimeError('Giờ kết thúc phải sau giờ bắt đầu.');
      return;
    }
    setTimeError('');
    const nextAgendaErrors = Object.fromEntries(
      agenda
        .filter((item) => !item.title.trim())
        .map((item) => [item.localId, 'Mục chương trình cần có tiêu đề.']),
    );
    if (Object.keys(nextAgendaErrors).length) {
      setAgendaErrors(nextAgendaErrors);
      return;
    }
    setAgendaErrors({});
    onSubmit({
      title: normalizedTitle,
      ...(description.trim() ? { description: description.trim() } : {}),
      attendeeIds,
      agenda: agenda.map((item, order) => ({
        ...(item.id ? { id: item.id } : {}),
        order,
        title: item.title.trim(),
        ...(item.description.trim() ? { description: item.description.trim() } : {}),
      })),
      startsAt: new Date(`${meetingDate}T${startTime}`).toISOString(),
      endsAt: new Date(`${meetingDate}T${endTime}`).toISOString(),
    });
  };

  return (
    <form className="app-form meeting-form" onSubmit={submit}>
      <section className="meeting-form-section">
        <div className="meeting-form-section-heading">
          <h3>Thông tin cuộc họp</h3>
          <p>Đặt tên rõ ràng và chọn thời gian diễn ra.</p>
        </div>
        <label>
          Tiêu đề
          <input
            value={title}
            aria-invalid={Boolean(titleError)}
            aria-describedby={titleError ? 'meeting-title-error' : undefined}
            onChange={(event) => {
              setTitle(event.target.value);
              if (event.target.value.trim().length >= 2) setTitleError('');
            }}
            minLength={2}
            maxLength={150}
            placeholder="Ví dụ: Họp tiến độ tuần"
            required
          />
        </label>
        {titleError && (
          <p className="meeting-field-error" id="meeting-title-error" role="alert">
            {titleError}
          </p>
        )}
        <div className="meeting-time-fields">
          <label className="meeting-date-field">
            Ngày họp
            <input
              type="date"
              value={meetingDate}
              onChange={(event) => setMeetingDate(event.target.value)}
              required
            />
          </label>
          <label>
            Bắt đầu
            <select
              value={startTime}
              onChange={(event) => {
                setStartTime(event.target.value);
                setTimeError('');
              }}
              required
              aria-invalid={Boolean(timeError)}
              aria-describedby={timeError ? 'meeting-time-error' : undefined}
            >
              {startTime && !timeOptions.includes(startTime) && (
                <option value={startTime}>{startTime}</option>
              )}
              {timeOptions.map((time) => (
                <option key={time} value={time}>
                  {time}
                </option>
              ))}
            </select>
          </label>
          <label>
            Kết thúc
            <select
              value={endTime}
              onChange={(event) => {
                setEndTime(event.target.value);
                setTimeError('');
              }}
              required
              aria-invalid={Boolean(timeError)}
              aria-describedby={timeError ? 'meeting-time-error' : undefined}
            >
              {endTime && !timeOptions.includes(endTime) && (
                <option value={endTime}>{endTime}</option>
              )}
              {timeOptions.map((time) => (
                <option key={time} value={time}>
                  {time}
                </option>
              ))}
            </select>
          </label>
        </div>
        {timeError && (
          <p className="meeting-field-error" id="meeting-time-error" role="alert">
            {timeError}
          </p>
        )}
        <label>
          Mục tiêu hoặc ghi chú <span>(không bắt buộc)</span>
          <textarea
            value={description}
            aria-invalid={Boolean(descriptionError)}
            aria-describedby={descriptionError ? 'meeting-description-error' : undefined}
            onChange={(event) => {
              setDescription(event.target.value);
              if (event.target.value.trim().length <= 2000) setDescriptionError('');
            }}
            rows={2}
            maxLength={2000}
            placeholder="Nêu ngắn gọn mục tiêu cần đạt được sau cuộc họp"
          />
        </label>
        {descriptionError && (
          <p className="meeting-field-error" id="meeting-description-error" role="alert">
            {descriptionError}
          </p>
        )}
      </section>
      <fieldset className="meeting-agenda-editor">
        <legend className="sr-only">Chương trình họp</legend>
        <div className="meeting-form-section-heading">
          <h3>Chương trình họp</h3>
          <p>Dùng mẫu có sẵn hoặc điều chỉnh từng nội dung theo nhu cầu.</p>
        </div>
        <div className="meeting-agenda-preset">
          <label>
            Mẫu chương trình họp
            <select
              value={agendaPreset}
              onChange={(event) => setAgendaPreset(event.target.value as AgendaPresetId)}
            >
              {agendaPresets.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.label}
                </option>
              ))}
            </select>
          </label>
          <button className="button-secondary" type="button" onClick={requestAgendaPreset}>
            Áp dụng mẫu
          </button>
        </div>
        {pendingAgendaPreset && (
          <div className="meeting-agenda-confirm" role="alert">
            <span>Áp dụng mẫu mới sẽ thay thế chương trình hiện tại.</span>
            <div>
              <button type="button" onClick={() => applyAgendaPreset(pendingAgendaPreset)}>
                Áp dụng và thay thế
              </button>
              <button
                className="button-quiet"
                type="button"
                onClick={() => setPendingAgendaPreset(null)}
              >
                Giữ nguyên
              </button>
            </div>
          </div>
        )}
        {agenda.length === 0 ? (
          <p className="meeting-agenda-empty">Chưa có mục chương trình nào.</p>
        ) : (
          <div className="meeting-agenda-editor-list">
            {agenda.map((item, index) => (
              <div className="meeting-agenda-editor-item" key={item.localId}>
                <span className="meeting-agenda-index" aria-hidden="true">
                  {index + 1}
                </span>
                <div className="meeting-agenda-editor-content">
                  <label className="sr-only" htmlFor={`${item.localId}-title`}>
                    Tiêu đề mục chương trình {index + 1}
                  </label>
                  <input
                    id={`${item.localId}-title`}
                    value={item.title}
                    maxLength={200}
                    placeholder="Nhập nội dung cần trao đổi"
                    aria-invalid={Boolean(agendaErrors[item.localId])}
                    aria-describedby={
                      agendaErrors[item.localId] ? `${item.localId}-error` : undefined
                    }
                    onChange={(event) => {
                      const title = event.target.value;
                      setAgenda((current) =>
                        current.map((entry) =>
                          entry.localId === item.localId ? { ...entry, title } : entry,
                        ),
                      );
                      if (title.trim())
                        setAgendaErrors((current) => {
                          const next = { ...current };
                          delete next[item.localId];
                          return next;
                        });
                    }}
                  />
                  {agendaErrors[item.localId] && (
                    <p className="meeting-field-error" id={`${item.localId}-error`} role="alert">
                      {agendaErrors[item.localId]}
                    </p>
                  )}
                  <details className="meeting-agenda-description" open={Boolean(item.description)}>
                    <summary>{item.description ? 'Mô tả chi tiết' : 'Thêm mô tả'}</summary>
                    <label>
                      <span className="sr-only">Mô tả mục chương trình {index + 1}</span>
                      <textarea
                        value={item.description}
                        rows={2}
                        maxLength={1000}
                        placeholder="Thông tin chuẩn bị hoặc kết quả mong đợi"
                        onChange={(event) => {
                          const description = event.target.value;
                          setAgenda((current) =>
                            current.map((entry) =>
                              entry.localId === item.localId ? { ...entry, description } : entry,
                            ),
                          );
                        }}
                      />
                    </label>
                  </details>
                </div>
                <div className="meeting-agenda-actions">
                  <button
                    className="button-quiet"
                    type="button"
                    aria-label={`Di chuyển mục chương trình ${index + 1} lên`}
                    title="Di chuyển lên"
                    disabled={index === 0}
                    onClick={() =>
                      setAgenda((current) => {
                        const next = [...current];
                        [next[index - 1], next[index]] = [next[index]!, next[index - 1]!];
                        return next;
                      })
                    }
                  >
                    ↑
                  </button>
                  <button
                    className="button-quiet"
                    type="button"
                    aria-label={`Di chuyển mục chương trình ${index + 1} xuống`}
                    title="Di chuyển xuống"
                    disabled={index === agenda.length - 1}
                    onClick={() =>
                      setAgenda((current) => {
                        const next = [...current];
                        [next[index], next[index + 1]] = [next[index + 1]!, next[index]!];
                        return next;
                      })
                    }
                  >
                    ↓
                  </button>
                  <button
                    className="button-danger-quiet"
                    type="button"
                    aria-label={`Xóa mục chương trình ${index + 1}`}
                    title="Xóa nội dung"
                    onClick={() => {
                      setAgenda((current) =>
                        current.filter((entry) => entry.localId !== item.localId),
                      );
                      setAgendaErrors((current) => {
                        const next = { ...current };
                        delete next[item.localId];
                        return next;
                      });
                    }}
                  >
                    ×
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        <button
          className="button-secondary meeting-agenda-add"
          type="button"
          onClick={() => setAgenda((current) => [...current, createAgendaDraft()])}
        >
          Thêm mục chương trình
        </button>
      </fieldset>
      <fieldset className="meeting-attendees">
        <legend className="sr-only">Người tham dự</legend>
        <div className="meeting-form-section-heading meeting-attendees-heading">
          <div>
            <h3>Người tham dự</h3>
            <p>Chọn thành viên cần nhận lịch và tham gia cuộc họp.</p>
          </div>
          <span>{attendeeIds.length} đã chọn</span>
        </div>
        <div>
          {group.members.map(({ membership, user }) => {
            const name = user?.displayName || user?.email || membership.userId;
            return (
              <label className="meeting-attendee-option" key={membership.userId}>
                <input
                  type="checkbox"
                  checked={attendeeIds.includes(membership.userId)}
                  onChange={(event) =>
                    setAttendeeIds((current) =>
                      event.target.checked
                        ? [...current, membership.userId]
                        : current.filter((id) => id !== membership.userId),
                    )
                  }
                />
                <span className="meeting-attendee-copy">
                  <strong>{name}</strong>
                  {user?.email && user.email !== name && <small>{user.email}</small>}
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="meeting-form-actions">
        <span>Kiểm tra lại thời gian và người tham dự trước khi lưu.</span>
        <button type="submit" disabled={pending}>
          {pending ? 'Đang lưu…' : submitLabel}
        </button>
      </div>
    </form>
  );
}

export function GroupMeetingsPage() {
  const { groupId = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const groupQuery = useQuery({
    queryKey: ['groups', groupId],
    queryFn: () => getGroup(groupId),
    enabled: Boolean(groupId),
  });
  const meetingsQuery = useInfiniteQuery({
    queryKey: ['groups', groupId, 'meetings', 'timeline'],
    queryFn: async ({ pageParam }) => {
      const page = await getMeetings(groupId, pageParam ? { cursor: pageParam } : {});
      return (Array.isArray(page) ? { items: page } : page) as MeetingTimelineResponse;
    },
    initialPageParam: '' as string,
    getNextPageParam: (page) => page.nextCursor,
    enabled: Boolean(groupId),
  });
  const mutation = useMutation({
    mutationFn: (input: CreateMeetingRequest) => createMeeting(groupId, input, crypto.randomUUID()),
    onSuccess: async (meeting) => {
      await queryClient.invalidateQueries({ queryKey: ['groups', groupId, 'meetings'] });
      navigate(`/app/meetings/${meeting.id}`);
    },
  });
  const meetings = useMemo(
    () =>
      [...(meetingsQuery.data?.pages.flatMap((page) => page.items) ?? [])].sort(
        (a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt),
      ),
    [meetingsQuery.data],
  );
  const upcoming = meetings.filter(
    (meeting) =>
      meeting.status !== 'CANCELLED' &&
      meeting.status !== 'COMPLETED' &&
      Date.parse(meeting.endsAt) >= Date.now(),
  );
  const history = meetings.filter((meeting) => !upcoming.includes(meeting));
  const isAdmin = groupQuery.data?.group.role === 'GROUP_ADMIN';
  const serverNeedsUpdate =
    meetingsQuery.isError && /(?:404|501)/.test(meetingsQuery.error.message);

  return (
    <FeaturePage
      title="Cuộc họp"
      description={
        groupQuery.data
          ? `Lịch làm việc chung của ${groupQuery.data.group.name}.`
          : 'Lịch làm việc chung của nhóm.'
      }
    >
      <div className={`meeting-page-layout${isAdmin ? '' : ' meeting-page-layout-single'}`}>
        <section
          className={`app-panel meeting-directory${
            meetingsQuery.isError || groupQuery.isError ? ' meeting-directory-error' : ''
          }`}
        >
          <div className="section-heading meeting-directory-heading">
            <div>
              <span className="section-kicker">Lịch chung</span>
              <h2>Sắp tới</h2>
            </div>
            {meetingsQuery.isSuccess && groupQuery.isSuccess && (
              <span className="meeting-count">{upcoming.length} cuộc họp</span>
            )}
          </div>
          {meetingsQuery.isPending || groupQuery.isPending ? (
            <div className="meeting-list-skeleton" role="status" aria-label="Đang tải lịch họp">
              <span />
              <span />
              <span />
            </div>
          ) : meetingsQuery.isError || groupQuery.isError ? (
            <div className="state state-error" role="alert">
              <strong>
                {serverNeedsUpdate
                  ? 'Máy chủ chưa có chức năng cuộc họp'
                  : 'Chưa tải được lịch họp'}
              </strong>
              <p>
                {serverNeedsUpdate
                  ? 'Cần triển khai phiên bản CampusMeet mới lên AWS trước khi sử dụng.'
                  : 'Kiểm tra kết nối rồi thử lại.'}
              </p>
              <button
                type="button"
                onClick={() => void Promise.all([meetingsQuery.refetch(), groupQuery.refetch()])}
              >
                Thử lại
              </button>
            </div>
          ) : upcoming.length ? (
            <div className="meeting-list">
              {upcoming.map((meeting) => (
                <MeetingListItem key={meeting.id} meeting={meeting} />
              ))}
            </div>
          ) : (
            <div className="meeting-empty-state">
              <strong>Chưa có cuộc họp sắp tới</strong>
              <p>
                {isAdmin
                  ? 'Tạo lịch đầu tiên bằng biểu mẫu lên lịch.'
                  : 'Quản trị viên nhóm chưa tạo lịch mới.'}
              </p>
            </div>
          )}
          {meetingsQuery.hasNextPage && (
            <button
              type="button"
              disabled={meetingsQuery.isFetchingNextPage}
              onClick={() => void meetingsQuery.fetchNextPage()}
            >
              {meetingsQuery.isFetchingNextPage ? 'Đang tải thêm…' : 'Xem thêm'}
            </button>
          )}
          {meetingsQuery.isFetchNextPageError && (
            <p className="error" role="alert">
              Không thể tải trang tiếp theo. Danh sách đã tải vẫn được giữ.
            </p>
          )}{' '}
          {history.length > 0 && (
            <details className="meeting-history">
              <summary>Lịch sử ({history.length})</summary>
              <div className="meeting-list">
                {history.map((meeting) => (
                  <MeetingListItem key={meeting.id} meeting={meeting} />
                ))}
              </div>
            </details>
          )}
        </section>
        {isAdmin && groupQuery.data && (
          <section className="app-panel create-meeting-panel">
            <span className="section-kicker">Lên lịch</span>
            <h2>Tạo cuộc họp</h2>
            <p>Thêm thời gian, nội dung và người tham dự trong nhóm.</p>
            <MeetingForm
              group={groupQuery.data}
              submitLabel="Tạo cuộc họp"
              pending={mutation.isPending}
              error={mutation.isError ? meetingErrorMessage(mutation.error, 'create') : undefined}
              onSubmit={(input) => mutation.mutate(input)}
            />
          </section>
        )}
      </div>
    </FeaturePage>
  );
}

function MeetingListItem({ meeting }: { meeting: Meeting }) {
  return (
    <Link to={`/app/meetings/${meeting.id}`} className="meeting-list-item">
      <span className="meeting-date-chip">
        <strong>{new Date(meeting.startsAt).getDate()}</strong>
        <small>thg {new Date(meeting.startsAt).getMonth() + 1}</small>
      </span>
      <span className="meeting-list-copy">
        <strong>{meeting.title}</strong>
        <small>{formatDate(meeting.startsAt)}</small>
      </span>
      <span className={`meeting-status meeting-status-${meeting.status.toLowerCase()}`}>
        {statusLabel[meeting.status] ?? 'Chưa xác định'}
      </span>
    </Link>
  );
}

export function MeetingDetailPage() {
  const { meetingId = '' } = useParams();
  const auth = useAuth();
  const queryClient = useQueryClient();
  const [conflictMessage, setConflictMessage] = useState('');
  const [reloadError, setReloadError] = useState('');
  const [reloadSuccess, setReloadSuccess] = useState('');
  const [isReloading, setIsReloading] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelReasonError, setCancelReasonError] = useState('');
  useEffect(() => {
    setConflictMessage('');
    setReloadError('');
    setReloadSuccess('');
    setIsReloading(false);
    setCancelReason('');
    setCancelReasonError('');
  }, [meetingId]);
  const query = useQuery({
    queryKey: ['meetings', meetingId],
    queryFn: () => getMeeting(meetingId),
    enabled: Boolean(meetingId),
  });
  const groupQuery = useQuery({
    queryKey: ['groups', query.data?.groupId],
    queryFn: () => getGroup(query.data!.groupId),
    enabled: Boolean(query.data?.groupId),
  });
  const minutesQueryKey = ['meetings', meetingId, 'minutes'] as const;
  const minutesQuery = useQuery({
    queryKey: minutesQueryKey,
    queryFn: () => getMeetingMinutes(meetingId),
    enabled: Boolean(meetingId && query.data),
    retry: false,
  });
  const updateMutation = useMutation({
    mutationFn: (input: CreateMeetingRequest) =>
      updateMeeting(meetingId, { ...input, version: query.data!.version }),
    onMutate: () => {
      setConflictMessage('');
      setReloadError('');
      setReloadSuccess('');
    },
    onSuccess: async (updated) => {
      queryClient.setQueryData(['meetings', meetingId], updated);
      await queryClient.invalidateQueries({
        queryKey: ['groups', query.data?.groupId, 'meetings'],
      });
    },
    onError: (error) => {
      if (error instanceof ApiClientError && error.status === 409) {
        setConflictMessage(
          'Cuộc họp đã được cập nhật ở nơi khác. Dữ liệu bạn đang chỉnh sửa chưa được lưu. Hãy tải lại phiên bản mới nhất trước khi tiếp tục.',
        );
      }
    },
  });
  const cancelMutation = useMutation({
    mutationFn: (reason?: string) =>
      cancelMeeting(meetingId, {
        ...(reason ? { reason } : {}),
        version: query.data?.version,
      }),
    onSuccess: async (cancelled) => {
      queryClient.setQueryData(['meetings', meetingId], cancelled);
      await queryClient.invalidateQueries({
        queryKey: ['groups', query.data?.groupId, 'meetings'],
      });
    },
  });
  const googleRetryMutation = useMutation({
    mutationFn: () => retryGoogleMeetingSync(meetingId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['meetings', meetingId] }),
  });

  if (query.isPending)
    return (
      <FeaturePage title="Cuộc họp" description="Đang tải thông tin…">
        <div className="state">Đang tải…</div>
      </FeaturePage>
    );
  if (query.isError)
    return (
      <FeaturePage title="Cuộc họp" description="Không thể mở cuộc họp.">
        <div className="state state-error" role="alert">
          <strong>{meetingErrorMessage(query.error, 'detail')}</strong>
          <button type="button" onClick={() => void query.refetch()}>
            Thử lại
          </button>
        </div>
      </FeaturePage>
    );

  const meeting = query.data;
  const isAdmin = groupQuery.data?.group.role === 'GROUP_ADMIN';
  const currentUserId = auth.status === 'authenticated' ? auth.user.userId : '';
  const canGenerateMeetingOutputs = isAdmin || meeting.organizerId === currentUserId;
  const minutesMissing =
    minutesQuery.isError &&
    minutesQuery.error instanceof ApiClientError &&
    minutesQuery.error.status === 404;
  const visibleGoogleSyncStatus = meeting.googleSync?.status ?? meeting.googleSyncStatus;
  return (
    <FeaturePage title={meeting.title} description={formatDate(meeting.startsAt)}>
      <div className="meeting-detail-layout">
        <section className="app-panel meeting-overview">
          <div className="meeting-overview-heading">
            <span className={`meeting-status meeting-status-${meeting.status.toLowerCase()}`}>
              {statusLabel[meeting.status] ?? 'Chưa xác định'}
            </span>
            <span>
              {Math.max(
                1,
                Math.round((Date.parse(meeting.endsAt) - Date.parse(meeting.startsAt)) / 60000),
              )}{' '}
              phút
            </span>
          </div>
          {meeting.googleSync?.status === 'PENDING' && (
            <div className="state meeting-google-pending" role="status">
              <p>Google Meet đang được đồng bộ. Quá trình này thường hoàn tất trong vài phút.</p>
              {meeting.organizerId === currentUserId && (
                <Link to="/app/settings">Kiểm tra kết nối Google</Link>
              )}
            </div>
          )}
          {meeting.googleSync?.status === 'FAILED' && (
            <div className="state state-error" role="status">
              <p>Đồng bộ Google Calendar/Meet thất bại.</p>
              {isAdmin && (
                <button
                  type="button"
                  disabled={googleRetryMutation.isPending}
                  onClick={() => googleRetryMutation.mutate()}
                  aria-label="Thử đồng bộ lại Google Meet"
                >
                  {googleRetryMutation.isPending ? 'Đang gửi yêu cầu…' : 'Thử đồng bộ lại'}
                </button>
              )}
              {googleRetryMutation.isError && (
                <p role="alert">Không thể gửi yêu cầu đồng bộ lại. Vui lòng thử lại.</p>
              )}
            </div>
          )}
          {meeting.googleSync?.status === 'ACTION_REQUIRED' && (
            <div className="state state-error" role="status">
              <p>Cần kết nối lại tài khoản Google để đồng bộ cuộc họp.</p>
              {meeting.organizerId === currentUserId && (
                <Link to="/app/settings">Kết nối lại Google</Link>
              )}
            </div>
          )}
          {meeting.googleSync?.status === 'SYNCED' &&
            meeting.googleSync.meetUrl?.startsWith('https://meet.google.com/') && (
              <a
                className="button meeting-meet-link"
                href={meeting.googleSync.meetUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Tham gia Google Meet
              </a>
            )}
          <div className="meeting-detail-grid">
            <div>
              <small>Bắt đầu</small>
              <strong>{formatDate(meeting.startsAt)}</strong>
            </div>
            <div>
              <small>Kết thúc</small>
              <strong>{formatDate(meeting.endsAt)}</strong>
            </div>
            <div>
              <small>Đồng bộ Google</small>
              <strong>{googleSyncLabel[visibleGoogleSyncStatus] ?? 'Chưa xác định'}</strong>
            </div>
          </div>
          <div className="meeting-agenda">
            <small>Nội dung</small>
            <p>{meeting.description || 'Chưa có nội dung cho cuộc họp này.'}</p>
          </div>
          <div className="meeting-agenda-detail">
            <h2>Chương trình họp</h2>
            {meeting.agenda.length ? (
              <ol>
                {[...meeting.agenda]
                  .sort((a, b) => a.order - b.order)
                  .map((item) => (
                    <li key={item.id}>
                      <strong>{item.title}</strong>
                      {item.description && <p>{item.description}</p>}
                    </li>
                  ))}
              </ol>
            ) : (
              <p className="meeting-agenda-empty">Chưa có mục chương trình nào.</p>
            )}
          </div>
          {meeting.status === 'CANCELLED' &&
            (meeting.cancellationReason || meeting.cancelledAt) && (
              <div className="meeting-cancellation">
                <h2>Thông tin hủy</h2>
                {meeting.cancellationReason && (
                  <p>
                    <strong>Lý do:</strong> {meeting.cancellationReason}
                  </p>
                )}
                {meeting.cancelledAt && (
                  <p>
                    <strong>Thời điểm:</strong> {formatDate(meeting.cancelledAt)}
                  </p>
                )}
              </div>
            )}
        </section>
        {environment.capabilities.documentUpload && <MeetingAttachmentsPanel meeting={meeting} />}
        <aside className="app-panel meeting-attendee-panel">
          <span className="section-kicker">Thành phần</span>
          <h2>Người tham dự</h2>
          <div className="meeting-attendee-list">
            {meeting.attendeeIds.map((userId) => (
              <span key={userId}>{memberLabel(groupQuery.data, userId)}</span>
            ))}
          </div>
        </aside>
        <section className="app-panel meeting-minutes-panel">
          <div className="section-heading">
            <div>
              <span className="section-kicker">Sau cuộc họp</span>
              <h2>Biên bản</h2>
            </div>
          </div>
          {minutesQuery.isPending || groupQuery.isPending ? (
            <div className="state" role="status">
              Đang tải biên bản…
            </div>
          ) : minutesQuery.isError && !minutesMissing ? (
            <div className="state state-error" role="alert">
              <strong>Chưa thể tải biên bản</strong>
              <p>{minutesQuery.error.message}</p>
              <button type="button" onClick={() => void minutesQuery.refetch()}>
                Thử lại
              </button>
            </div>
          ) : minutesMissing && !isAdmin ? (
            <div className="minutes-empty">
              <strong>Chưa có biên bản</strong>
              <p>Cuộc họp này chưa có phiên bản biên bản nào.</p>
            </div>
          ) : minutesQuery.data ? (
            !isAdmin ? (
              <MinutesReadView minutes={minutesQuery.data} group={groupQuery.data} />
            ) : null
          ) : null}
          {(minutesMissing || minutesQuery.data) &&
            isAdmin &&
            groupQuery.data &&
            meeting.status !== 'CANCELLED' && (
              <MinutesEditor
                key="minutes-editor"
                meetingId={meetingId}
                initial={minutesQuery.data}
                group={groupQuery.data}
                currentUserId={currentUserId}
                queryKey={minutesQueryKey}
              />
            )}
          {(minutesMissing || minutesQuery.data) && isAdmin && meeting.status === 'CANCELLED' && (
            <p className="state">Không thể chỉnh sửa biên bản của cuộc họp đã hủy.</p>
          )}
        </section>
        {isAdmin &&
          groupQuery.data &&
          meeting.status !== 'CANCELLED' &&
          meeting.status !== 'COMPLETED' && (
            <details className="app-panel meeting-admin-panel">
              <summary>Chỉnh sửa cuộc họp</summary>
              <div className="meeting-admin-content">
                <MeetingForm
                  key={`${meeting.id}-${meeting.version}`}
                  group={groupQuery.data}
                  initial={meeting}
                  submitLabel="Lưu thay đổi"
                  pending={updateMutation.isPending}
                  error={
                    updateMutation.isError && !conflictMessage
                      ? meetingErrorMessage(updateMutation.error, 'update')
                      : undefined
                  }
                  onSubmit={(input) => updateMutation.mutate(input)}
                />
                {conflictMessage && (
                  <div className="meeting-conflict" role="alert">
                    <p>{conflictMessage}</p>
                    {reloadError && <p className="error">{reloadError}</p>}
                    <div>
                      <button
                        type="button"
                        disabled={isReloading}
                        onClick={async () => {
                          if (
                            !window.confirm(
                              'Tải phiên bản mới nhất sẽ thay thế dữ liệu bạn đang nhập. Tiếp tục?',
                            )
                          )
                            return;
                          setIsReloading(true);
                          setReloadError('');
                          try {
                            const latest = await getMeeting(meetingId);
                            queryClient.setQueryData(['meetings', meetingId], latest);
                            updateMutation.reset();
                            setConflictMessage('');
                            setReloadSuccess('Đã tải phiên bản cuộc họp mới nhất.');
                          } catch (error) {
                            setReloadError(
                              error instanceof Error
                                ? `Không thể tải phiên bản mới nhất: ${error.message}`
                                : 'Không thể tải phiên bản mới nhất.',
                            );
                          } finally {
                            setIsReloading(false);
                          }
                        }}
                      >
                        {isReloading ? 'Đang tải…' : 'Tải phiên bản mới nhất'}
                      </button>
                      <button type="button" onClick={() => setConflictMessage('')}>
                        Tiếp tục xem bản đang nhập
                      </button>
                    </div>
                  </div>
                )}
                {reloadSuccess && (
                  <p className="meeting-reload-success" role="status">
                    {reloadSuccess}
                  </p>
                )}
                <details className="meeting-cancel-panel">
                  <summary>Tùy chọn hủy cuộc họp</summary>
                  <div className="meeting-cancel-row">
                    <div>
                      <strong>Chỉ hủy khi cuộc họp không còn diễn ra</strong>
                      <p>
                        Cuộc họp sẽ chuyển vào lịch sử; biên bản và công việc đã tạo vẫn được giữ.
                      </p>
                      <label>
                        Lý do hủy <span>(không bắt buộc)</span>
                        <textarea
                          value={cancelReason}
                          rows={2}
                          maxLength={500}
                          aria-invalid={Boolean(cancelReasonError)}
                          aria-describedby={
                            cancelReasonError ? 'meeting-cancel-reason-error' : undefined
                          }
                          onChange={(event) => {
                            setCancelReason(event.target.value);
                            if (event.target.value.trim().length <= 500) setCancelReasonError('');
                          }}
                        />
                      </label>
                      {cancelReasonError && (
                        <p
                          className="meeting-field-error"
                          id="meeting-cancel-reason-error"
                          role="alert"
                        >
                          {cancelReasonError}
                        </p>
                      )}
                    </div>
                    <button
                      className="button-danger-quiet"
                      type="button"
                      disabled={cancelMutation.isPending}
                      onClick={() => {
                        const reason = cancelReason.trim();
                        if (reason.length > 500) {
                          setCancelReasonError('Lý do hủy không được vượt quá 500 ký tự.');
                          return;
                        }
                        if (window.confirm('Xác nhận hủy cuộc họp này?'))
                          cancelMutation.mutate(reason || undefined);
                      }}
                    >
                      {cancelMutation.isPending ? 'Đang hủy…' : 'Hủy cuộc họp'}
                    </button>
                  </div>
                </details>
                {cancelMutation.isError && (
                  <p className="error" role="alert">
                    {meetingErrorMessage(cancelMutation.error, 'cancel')}
                  </p>
                )}
              </div>
            </details>
          )}
        {environment.capabilities.ai && canGenerateMeetingOutputs && groupQuery.data && (
          <MeetingAIWorkspace meetingId={meeting.id} group={groupQuery.data} />
        )}
      </div>
    </FeaturePage>
  );
}
