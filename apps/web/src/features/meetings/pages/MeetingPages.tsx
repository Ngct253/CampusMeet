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

type MinutesDraft = Omit<UpdateMeetingMinutesRequest, 'expectedVersion'>;

const minutesDraft = (minutes?: MeetingMinutes): MinutesDraft => ({
  summary: minutes?.summary ?? '',
  discussion: minutes?.discussion ?? '',
  decisions: minutes?.decisions.map(({ content }) => ({ content })) ?? [],
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
  if (error.status === 400) return 'Thông tin tạo Task chưa hợp lệ.';
  if (error.status === 403) return 'Bạn không còn quyền Quản trị viên để tạo Task.';
  if (error.status === 404)
    return 'Việc cần thực hiện không còn trong phiên bản biên bản mới nhất.';
  if (error.status === 409)
    return 'Biên bản đã thay đổi hoặc việc này vừa được chuyển thành Task ở nơi khác.';
  if (error.status === 422) return error.message;
  return error.status >= 500
    ? 'CampusMeet đang tạm thời gặp sự cố. Vui lòng thử lại.'
    : error.message;
};

function MinutesReadView({ minutes, group }: { minutes: MeetingMinutes; group?: GroupDetails }) {
  return (
    <div className="minutes-read-view">
      <div className="minutes-version">Phiên bản {minutes.version}</div>
      <section>
        <h3>Tóm tắt</h3>
        <p>{minutes.summary}</p>
      </section>
      <section>
        <h3>Nội dung thảo luận</h3>
        <p>{minutes.discussion || 'Không có nội dung thảo luận.'}</p>
      </section>
      <section>
        <h3>Quyết định</h3>
        {minutes.decisions.length ? (
          <ul>
            {minutes.decisions.map((item) => (
              <li key={item.id}>{item.content}</li>
            ))}
          </ul>
        ) : (
          <p>Chưa có quyết định.</p>
        )}
      </section>
      <section>
        <h3>Việc cần thực hiện</h3>
        {minutes.actionItems.length ? (
          <ul>
            {minutes.actionItems.map((item) => (
              <li key={item.id}>
                {item.content}
                {item.assigneeId ? ` — ${memberLabel(group, item.assigneeId)}` : ''}
                {item.dueAt ? ` — hạn ${formatDate(item.dueAt)}` : ''}
                {item.taskId ? ' — Đã chuyển thành công việc' : ''}
              </li>
            ))}
          </ul>
        ) : (
          <p>Chưa có việc cần thực hiện.</p>
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
      setSuccessMessage('Đã chuyển việc cần thực hiện thành Task.');
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
      setErrorMessage('Nội dung nguồn vượt quá 200 ký tự; cần nhập tiêu đề Task.');
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
    <section className="action-item-task-panel" aria-label="Chuyển việc cần thực hiện thành Task">
      <div>
        <h3>Tạo Task từ biên bản</h3>
        <p>Chỉ các việc đã lưu trong phiên bản {minutes.version} mới có thể chuyển đổi.</p>
        {disabled && <p className="minutes-dirty">Hãy lưu thay đổi biên bản trước khi tạo Task.</p>}
      </div>
      <ul className="action-item-task-list">
        {minutes.actionItems.map((actionItem, index) => {
          const selected = selectedActionId === actionItem.id;
          return (
            <li key={actionItem.id || `persisted-action-${index}`} className="action-item-task-entry">
              <div className="action-item-task-heading">
                <span>
                  <strong>{actionItem.content}</strong>
                  {actionItem.assigneeId && (
                    <small>Người phụ trách: {memberLabel(group, actionItem.assigneeId)}</small>
                  )}
                </span>
                {actionItem.taskId ? (
                  <span className="action-item-task-converted">Đã chuyển thành công việc</span>
                ) : (
                  <button
                    type="button"
                    disabled={disabled || mutation.isPending}
                    onClick={() => openForm(actionItem.id)}
                  >
                    Tạo Task
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
                      <option value={Priority.LOW}>LOW</option>
                      <option value={Priority.MEDIUM}>MEDIUM</option>
                      <option value={Priority.HIGH}>HIGH</option>
                    </select>
                  </label>
                  {!actionItem.assigneeId && (
                    <label>
                      Người phụ trách
                      <select
                        aria-label={`Người phụ trách Task cho ${actionItem.content}`}
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
                    Tiêu đề Task{' '}
                    <span>
                      {actionItem.content.length > 200 ? '(bắt buộc)' : '(không bắt buộc)'}
                    </span>
                    <input
                      aria-label={`Tiêu đề Task cho ${actionItem.content}`}
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
                      {mutation.isPending ? 'Đang tạo…' : 'Xác nhận tạo Task'}
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
          {successMessage}
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

  const applyConvertedMinutes = (minutes: MeetingMinutes) => {
    setDraft(minutesDraft(minutes));
    setExpectedVersion(minutes.version);
    setDirty(false);
    setHasConflict(false);
    setMessage('');
  };

  return (
    <>
      <form className="minutes-editor" onSubmit={submit}>
      <div className="minutes-editor-heading">
        <span>Đang chỉnh sửa từ phiên bản {expectedVersion}</span>
        {dirty && <span className="minutes-dirty">Có thay đổi chưa lưu</span>}
      </div>
      <label>
        Tóm tắt
        <textarea
          value={draft.summary}
          onChange={(event) => changeDraft({ ...draft, summary: event.target.value })}
          minLength={1}
          maxLength={2000}
          rows={4}
          required
        />
      </label>
      <label>
        Nội dung thảo luận
        <textarea
          value={draft.discussion}
          onChange={(event) => changeDraft({ ...draft, discussion: event.target.value })}
          maxLength={10000}
          rows={7}
        />
      </label>
      <fieldset>
        <legend>Quyết định</legend>
        {draft.decisions.map((decision, index) => (
          <div className="minutes-row" key={`decision-${index}`}>
            <input
              aria-label={`Quyết định ${index + 1}`}
              value={decision.content}
              onChange={(event) =>
                changeDraft({
                  ...draft,
                  decisions: draft.decisions.map((item, itemIndex) =>
                    itemIndex === index ? { content: event.target.value } : item,
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
        <button
          type="button"
          disabled={mutation.isPending || draft.decisions.length >= 50}
          onClick={() =>
            changeDraft({ ...draft, decisions: [...draft.decisions, { content: '' }] })
          }
        >
          Thêm quyết định
        </button>
      </fieldset>
      <fieldset>
        <legend>Việc cần thực hiện</legend>
        {draft.actionItems.map((action, index) => (
          <div className="minutes-action-row" key={action.id ?? `action-new-${index}`}>
            <input
              aria-label={`Việc cần thực hiện ${index + 1}`}
              value={action.content}
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
              <option value="">Chưa giao</option>
              {group.members.map(({ membership, user }) => (
                <option key={membership.userId} value={membership.userId}>
                  {user?.displayName || user?.email || membership.userId}
                </option>
              ))}
            </select>
            <input
              aria-label={`Hạn hoàn thành ${index + 1}`}
              type="datetime-local"
              value={action.dueAt ? toLocalInput(action.dueAt) : ''}
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
                            ? { dueAt: new Date(event.target.value).toISOString() }
                            : {}),
                        }
                      : item,
                  ),
                })
              }
            />
            <button
              type="button"
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
        <button
          type="button"
          disabled={mutation.isPending || draft.actionItems.length >= 100}
          onClick={() =>
            changeDraft({ ...draft, actionItems: [...draft.actionItems, { content: '' }] })
          }
        >
          Thêm việc cần thực hiện
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
      <button type="submit" disabled={mutation.isPending}>
        {mutation.isPending ? 'Đang lưu…' : 'Lưu biên bản'}
      </button>
      </form>
      {initial && (
        <ActionItemTaskConversionPanel
          meetingId={meetingId}
          minutes={initial}
          group={group}
          currentUserId={currentUserId}
          disabled={dirty || mutation.isPending}
          queryKey={queryKey}
          onConverted={applyConvertedMinutes}
        />
      )}
    </>
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
          {attachment.contentType} · {(attachment.sizeBytes / (1024 * 1024)).toFixed(1)} MB
        </small>
      </div>
      <span className={`meeting-status meeting-status-${attachment.status.toLowerCase()}`}>
        {attachment.status}
      </span>
      <button
        type="button"
        className="button-quiet"
        onClick={() => onDownload(attachment.attachmentId)}
        disabled={downloading}
      >
        {downloading ? 'Đang lấy link…' : 'Tải xuống'}
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
  });
  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const contentType = (file.type || inferContentType(file.name)) as
        SupportedContentType | undefined;
      if (
        !contentType ||
        !supportedContentTypes.includes(contentType as (typeof supportedContentTypes)[number])
      ) {
        throw new Error('Định dạng file này chưa được hỗ trợ.');
      }
      if (file.size > maxAttachmentSizeBytes) {
        throw new Error('File vượt quá giới hạn 50 MB.');
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
        throw new Error('Không thể tải file lên kho lưu trữ.');
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
      <h2>Upload tài liệu hoặc audio</h2>
      <p>
        Tối đa 10 file cho mỗi cuộc họp, mỗi file tối đa 50 MB. Sau khi upload, hệ thống sẽ tạo một
        AIJob để xử lý tiếp.
      </p>
      <label className="meeting-upload-field">
        Chọn file
        <input
          type="file"
          accept={supportedContentTypes.join(',')}
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
        {uploadMutation.isPending ? 'Đang upload…' : 'Upload file'}
      </button>
      {uploadMutation.isError && (
        <p className="error" role="alert">
          {uploadMutation.error.message}
        </p>
      )}
      {attachmentsQuery.isPending ? (
        <div className="meeting-attachment-state" role="status">
          Đang tải danh sách file…
        </div>
      ) : attachmentsQuery.isError ? (
        <div className="meeting-attachment-state error" role="status">
          <strong>Không tải được danh sách file</strong>
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
        <div className="meeting-attachment-state">Chưa có file nào được gắn vào cuộc họp này.</div>
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
        Nội dung <span>(không bắt buộc)</span>
        <textarea
          value={description}
          aria-invalid={Boolean(descriptionError)}
          aria-describedby={descriptionError ? 'meeting-description-error' : undefined}
          onChange={(event) => {
            setDescription(event.target.value);
            if (event.target.value.trim().length <= 2000) setDescriptionError('');
          }}
          rows={3}
          maxLength={2000}
        />
      </label>
      {descriptionError && (
        <p className="meeting-field-error" id="meeting-description-error" role="alert">
          {descriptionError}
        </p>
      )}
      <fieldset className="meeting-agenda-editor">
        <legend>Chương trình họp</legend>
        {agenda.length === 0 ? (
          <p className="meeting-agenda-empty">Chưa có mục chương trình nào.</p>
        ) : (
          <div className="meeting-agenda-editor-list">
            {agenda.map((item, index) => (
              <div className="meeting-agenda-editor-item" key={item.localId}>
                <div className="meeting-agenda-editor-heading">
                  <strong>Mục chương trình {index + 1}</strong>
                  <div className="meeting-agenda-actions">
                    <button
                      type="button"
                      aria-label={`Di chuyển mục chương trình ${index + 1} lên`}
                      disabled={index === 0}
                      onClick={() =>
                        setAgenda((current) => {
                          const next = [...current];
                          [next[index - 1], next[index]] = [next[index]!, next[index - 1]!];
                          return next;
                        })
                      }
                    >
                      Di chuyển lên
                    </button>
                    <button
                      type="button"
                      aria-label={`Di chuyển mục chương trình ${index + 1} xuống`}
                      disabled={index === agenda.length - 1}
                      onClick={() =>
                        setAgenda((current) => {
                          const next = [...current];
                          [next[index], next[index + 1]] = [next[index + 1]!, next[index]!];
                          return next;
                        })
                      }
                    >
                      Di chuyển xuống
                    </button>
                    <button
                      className="button-danger-quiet"
                      type="button"
                      aria-label={`Xóa mục chương trình ${index + 1}`}
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
                      Xóa
                    </button>
                  </div>
                </div>
                <label>
                  Tiêu đề
                  <input
                    value={item.title}
                    maxLength={200}
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
                </label>
                {agendaErrors[item.localId] && (
                  <p className="meeting-field-error" id={`${item.localId}-error`} role="alert">
                    {agendaErrors[item.localId]}
                  </p>
                )}
                <label>
                  Mô tả <span>(không bắt buộc)</span>
                  <textarea
                    value={item.description}
                    rows={2}
                    maxLength={1000}
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
        <legend>Người tham dự</legend>
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
      <button type="submit" disabled={pending}>
        {pending ? 'Đang lưu…' : submitLabel}
      </button>
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
    queryKey: ['groups', groupId, 'meetings'],
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
                  ? 'Tạo lịch đầu tiên bằng biểu mẫu bên cạnh.'
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
              {meetingsQuery.isFetchingNextPage ? 'Äang táº£i thÃªmâ€¦' : 'Xem thÃªm'}
            </button>
          )}
          {meetingsQuery.isFetchNextPageError && (
            <p className="error" role="alert">
              KhÃ´ng thá»ƒ táº£i trang tiáº¿p theo. Danh sÃ¡ch Ä‘Ã£ táº£i váº«n Ä‘Æ°á»£c giá»¯.
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
        {statusLabel[meeting.status] ?? meeting.status}
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
  return (
    <FeaturePage title={meeting.title} description={formatDate(meeting.startsAt)}>
      <div className="meeting-detail-layout">
        <section className="app-panel meeting-overview">
          <div className="meeting-overview-heading">
            <span className={`meeting-status meeting-status-${meeting.status.toLowerCase()}`}>
              {statusLabel[meeting.status] ?? meeting.status}
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
            <p className="state" role="status">
              Google Meet đang được đồng bộ.
            </p>
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
        <MeetingAttachmentsPanel meeting={meeting} />
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
          ) : minutesMissing ? (
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
                <div className="meeting-cancel-row">
                  <div>
                    <strong>Hủy cuộc họp</strong>
                    <p>Cuộc họp vẫn được giữ trong lịch sử.</p>
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
                      if (window.confirm('Hủy cuộc họp này?'))
                        cancelMutation.mutate(reason || undefined);
                    }}
                  >
                    Hủy cuộc họp
                  </button>
                </div>
                {cancelMutation.isError && (
                  <p className="error" role="alert">
                    {meetingErrorMessage(cancelMutation.error, 'cancel')}
                  </p>
                )}
              </div>
            </details>
          )}
        {canGenerateMeetingOutputs && groupQuery.data && (
          <MeetingAIWorkspace meetingId={meeting.id} group={groupQuery.data} />
        )}
      </div>
    </FeaturePage>
  );
}
