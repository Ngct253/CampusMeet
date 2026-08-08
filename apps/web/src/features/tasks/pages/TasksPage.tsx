import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  GroupRole,
  Priority,
  TaskStatus,
  type CreateTaskRequest,
  type GroupDetails,
  type Task,
} from '@campusmeet/shared';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { FeaturePage } from '../../../components/FeaturePage';
import { StatusBadge } from '../../../components/ui';
import { getGroup, getGroups } from '../../groups/service';
import { getAllMeetings } from '../../meetings/service';
import { ApiClientError } from '../../../lib/api-client';
import { createTask, getTasks, updateTaskStatus } from '../service';
import './TasksPage.css';

type CreateAttempt = { key: string; normalizedInput: CreateTaskRequest };

const memberLabel = (group: GroupDetails | undefined, userId: string) => {
  const member = group?.members.find(({ membership }) => membership.userId === userId);
  return member?.user?.displayName || member?.user?.email || userId;
};

const sameInput = (left: CreateTaskRequest, right: CreateTaskRequest) =>
  JSON.stringify(left) === JSON.stringify(right);

const statusLabels: Record<TaskStatus, string> = {
  [TaskStatus.TODO]: 'Chưa làm',
  [TaskStatus.DOING]: 'Đang làm',
  [TaskStatus.DONE]: 'Hoàn thành',
};

const priorityLabels: Record<Priority, string> = {
  [Priority.LOW]: 'Thấp',
  [Priority.MEDIUM]: 'Vừa',
  [Priority.HIGH]: 'Cao',
};

const formatDueAtPreview = (value: string) =>
  new Intl.DateTimeFormat('vi-VN', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(`${value}T00:00:00`));

const toLocalDateValue = (value: string) => {
  const date = new Date(value);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 10);
};

const formatDateTime = (value: string) =>
  new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));

export const TasksPage = () => {
  const queryClient = useQueryClient();
  const tasksQuery = useQuery({ queryKey: ['tasks'], queryFn: getTasks });
  const groupsQuery = useQuery({ queryKey: ['groups'], queryFn: getGroups });
  const adminGroups = useMemo(
    () => groupsQuery.data?.filter(({ role }) => role === GroupRole.GROUP_ADMIN) ?? [],
    [groupsQuery.data],
  );
  const [groupId, setGroupId] = useState('');
  const [title, setTitle] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [priority, setPriority] = useState<Priority>(Priority.MEDIUM);
  const [dueAt, setDueAt] = useState('');
  const [sourceMeetingId, setSourceMeetingId] = useState('');
  const [formError, setFormError] = useState('');
  const [meetingError, setMeetingError] = useState('');
  const [statusError, setStatusError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [completionTaskId, setCompletionTaskId] = useState('');
  const [completionNote, setCompletionNote] = useState('');
  const [completionEvidenceUrl, setCompletionEvidenceUrl] = useState('');
  const [completionError, setCompletionError] = useState('');
  const attemptRef = useRef<CreateAttempt | undefined>(undefined);
  const submittingRef = useRef(false);
  const statusSubmittingRef = useRef(false);

  useEffect(() => {
    if (!groupsQuery.isSuccess) return;
    setGroupId((current) =>
      adminGroups.some(({ id }) => id === current) ? current : (adminGroups[0]?.id ?? ''),
    );
  }, [adminGroups, groupsQuery.isSuccess]);

  const groupQuery = useQuery({
    queryKey: ['groups', groupId],
    queryFn: () => getGroup(groupId),
    enabled: Boolean(groupId),
  });
  const meetingsQuery = useQuery({
    queryKey: ['groups', groupId, 'meetings'],
    queryFn: () => getAllMeetings(groupId),
    enabled: Boolean(groupId),
  });

  const createMutation = useMutation({
    mutationFn: ({ input, key }: { input: CreateTaskRequest; key: string }) =>
      createTask(input, key),
    onSuccess: async (task) => {
      const recipient = memberLabel(groupQuery.data, task.assigneeId);
      setSuccessMessage(
        task.createdBy === task.assigneeId
          ? 'Đã tạo công việc và giao cho bạn.'
          : `Đã tạo công việc và giao cho ${recipient}.`,
      );
      setTitle('');
      setAssigneeId('');
      setPriority(Priority.MEDIUM);
      setDueAt('');
      setSourceMeetingId('');
      setFormError('');
      setMeetingError('');
      attemptRef.current = undefined;
      await queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
    onError: async (error) => {
      if (!(error instanceof ApiClientError)) {
        setFormError(error.message);
        return;
      }
      if (error.status === 400) {
        setFormError('Thông tin công việc chưa hợp lệ.');
      } else if (error.status === 403) {
        setFormError('Bạn không còn quyền Quản trị viên của nhóm này.');
        await queryClient.invalidateQueries({ queryKey: ['groups'] });
      } else if (error.status === 404) {
        setMeetingError('Cuộc họp đã chọn không còn tồn tại trong nhóm.');
        setSourceMeetingId('');
        attemptRef.current = undefined;
        await queryClient.invalidateQueries({ queryKey: ['groups', groupId, 'meetings'] });
      } else if (error.status === 409) {
        setFormError('Yêu cầu tạo công việc bị xung đột. Vui lòng gửi lại.');
        attemptRef.current = undefined;
      } else if (error.status === 422) {
        setFormError('Người phụ trách không còn là thành viên hoạt động của nhóm.');
        setAssigneeId('');
        attemptRef.current = undefined;
        await queryClient.invalidateQueries({ queryKey: ['groups', groupId] });
      } else {
        setFormError(error.message);
      }
    },
    onSettled: () => {
      submittingRef.current = false;
    },
  });

  const statusMutation = useMutation({
    mutationFn: ({
      task,
      status,
      result,
      evidenceUrl,
    }: {
      task: Task;
      status: TaskStatus;
      result?: string;
      evidenceUrl?: string;
    }) =>
      updateTaskStatus(task.id, {
        status,
        expectedVersion: task.version ?? 0,
        ...(result ? { completionNote: result } : {}),
        ...(evidenceUrl ? { completionEvidenceUrl: evidenceUrl } : {}),
      }),
    onMutate: () => {
      setStatusError('');
      setCompletionError('');
    },
    onSuccess: async () => {
      setStatusError('');
      setCompletionTaskId('');
      setCompletionNote('');
      setCompletionEvidenceUrl('');
      await queryClient.invalidateQueries({ queryKey: ['tasks'] });
      await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: async (error, variables) => {
      if (error instanceof ApiClientError && error.status === 409) {
        setStatusError('Công việc đã được cập nhật ở nơi khác. Danh sách đang được làm mới.');
        await queryClient.invalidateQueries({ queryKey: ['tasks'] });
      } else if (error instanceof ApiClientError && error.status === 403) {
        setStatusError('Bạn không có quyền cập nhật công việc này.');
      } else if (error instanceof ApiClientError && error.status === 422) {
        if (variables.status === TaskStatus.DONE) {
          setCompletionError('Chưa thể ghi nhận hoàn thành. Hãy kiểm tra lại phần kết quả.');
        } else {
          setStatusError('Không thể chuyển sang trạng thái công việc đã chọn.');
        }
      } else {
        setStatusError(error.message);
      }
    },
    onSettled: () => {
      statusSubmittingRef.current = false;
    },
  });

  const changeTaskStatus = (task: Task, status: TaskStatus) => {
    if (statusSubmittingRef.current || statusMutation.isPending) return;
    statusSubmittingRef.current = true;
    statusMutation.mutate({ task, status });
  };

  const completeTask = (task: Task) => {
    if (statusSubmittingRef.current || statusMutation.isPending) return;
    const result = completionNote.trim();
    const evidenceUrl = completionEvidenceUrl.trim();
    if (result.length < 3) {
      setCompletionError('Hãy mô tả ngắn gọn kết quả đã hoàn thành.');
      return;
    }
    if (evidenceUrl) {
      try {
        new URL(evidenceUrl);
      } catch {
        setCompletionError('Liên kết minh chứng chưa đúng định dạng.');
        return;
      }
    }
    statusSubmittingRef.current = true;
    statusMutation.mutate({
      task,
      status: TaskStatus.DONE,
      result,
      ...(evidenceUrl ? { evidenceUrl } : {}),
    });
  };

  const changeGroup = (nextGroupId: string) => {
    setGroupId(nextGroupId);
    setAssigneeId('');
    setSourceMeetingId('');
    setFormError('');
    setMeetingError('');
    setSuccessMessage('');
    attemptRef.current = undefined;
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (submittingRef.current || createMutation.isPending) return;
    setMeetingError('');
    const normalizedTitle = title.trim();
    const normalizedGroupId = groupId.trim();
    const normalizedAssigneeId = assigneeId.trim();
    if (
      !normalizedTitle ||
      normalizedTitle.length > 200 ||
      !normalizedGroupId ||
      !normalizedAssigneeId
    ) {
      setFormError('Thông tin công việc chưa hợp lệ.');
      return;
    }
    const normalizedInput: CreateTaskRequest = {
      groupId: normalizedGroupId,
      title: normalizedTitle,
      assigneeId: normalizedAssigneeId,
      priority,
      ...(dueAt ? { dueAt: new Date(`${dueAt}T23:59:59`).toISOString() } : {}),
      ...(sourceMeetingId.trim() ? { sourceMeetingId: sourceMeetingId.trim() } : {}),
    };
    const currentAttempt = attemptRef.current;
    const attempt =
      currentAttempt && sameInput(currentAttempt.normalizedInput, normalizedInput)
        ? currentAttempt
        : { key: crypto.randomUUID(), normalizedInput };
    attemptRef.current = attempt;
    submittingRef.current = true;
    setFormError('');
    setSuccessMessage('');
    createMutation.mutate({ input: normalizedInput, key: attempt.key });
  };

  return (
    <FeaturePage title="Công việc" description="Theo dõi công việc được giao và tiến độ cá nhân.">
      <div className="task-page-layout">
        <details className="app-panel create-task-panel">
          <summary>
            <span>
              <small className="section-kicker">Phân công</small>
              <strong>Tạo công việc</strong>
            </span>
            <span aria-hidden="true">＋</span>
          </summary>
          {groupsQuery.isPending ? (
            <p role="status">Đang tải nhóm quản trị…</p>
          ) : groupsQuery.isError ? (
            <div className="state state-error" role="alert">
              <strong>Chưa thể tải danh sách nhóm</strong>
              <button type="button" onClick={() => void groupsQuery.refetch()}>
                Thử lại
              </button>
            </div>
          ) : adminGroups.length === 0 ? (
            <p>Bạn cần là Quản trị viên nhóm để tạo công việc.</p>
          ) : (
            <form className="app-form task-form" onSubmit={submit}>
              <label>
                Nhóm
                <select
                  value={groupId}
                  onChange={(event) => changeGroup(event.target.value)}
                  required
                >
                  {adminGroups.map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Tiêu đề
                <input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  maxLength={200}
                  required
                />
              </label>
              <label>
                Người phụ trách
                <select
                  value={assigneeId}
                  onChange={(event) => setAssigneeId(event.target.value)}
                  disabled={groupQuery.isPending || groupQuery.isError}
                  required
                >
                  <option value="">
                    {groupQuery.isError ? 'Không tải được thành viên' : 'Chọn người phụ trách'}
                  </option>
                  {groupQuery.data?.members.map(({ membership, user }) => (
                    <option key={membership.userId} value={membership.userId}>
                      {user?.displayName || user?.email || membership.userId}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Mức ưu tiên
                <select
                  value={priority}
                  onChange={(event) => setPriority(event.target.value as Priority)}
                >
                  {Object.values(Priority).map((value) => (
                    <option key={value} value={value}>
                      {priorityLabels[value]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Hạn hoàn thành <span>(không bắt buộc)</span>
                <input
                  type="date"
                  value={dueAt}
                  onChange={(event) => setDueAt(event.target.value)}
                />
                {dueAt && <small>Hoàn thành trước cuối ngày {formatDueAtPreview(dueAt)}</small>}
              </label>
              <details className="task-form-optional">
                <summary>Liên kết với cuộc họp</summary>
                <label>
                  Cuộc họp
                  <select
                    value={sourceMeetingId}
                    onChange={(event) => {
                      setSourceMeetingId(event.target.value);
                      setMeetingError('');
                    }}
                    onFocus={() => setMeetingError('')}
                    onPointerDown={() => setMeetingError('')}
                    disabled={meetingsQuery.isPending || meetingsQuery.isError}
                  >
                    <option value="">
                      {meetingsQuery.isError
                        ? 'Không tải được cuộc họp'
                        : 'Không liên kết cuộc họp'}
                    </option>
                    {meetingsQuery.data?.map((meeting) => (
                      <option key={meeting.id} value={meeting.id}>
                        {meeting.title}
                      </option>
                    ))}
                  </select>
                </label>
                {meetingsQuery.isError && (
                  <p className="task-field-note">
                    Bạn vẫn có thể tạo công việc không liên kết cuộc họp.
                  </p>
                )}
              </details>
              {meetingError && (
                <p className="error" role="alert">
                  {meetingError}
                </p>
              )}
              {formError && (
                <p className="error" role="alert">
                  {formError}
                </p>
              )}
              {successMessage && (
                <p className="task-success" role="status">
                  {successMessage}
                </p>
              )}
              <button
                type="submit"
                disabled={createMutation.isPending || groupQuery.isPending || groupQuery.isError}
              >
                {createMutation.isPending ? 'Đang tạo…' : 'Tạo công việc'}
              </button>
            </form>
          )}
        </details>

        <section className="app-panel assigned-task-panel">
          <div className="task-list-heading">
            <div>
              <h2>Công việc của tôi</h2>
              <p>Bắt đầu công việc, cập nhật kết quả và lưu minh chứng khi hoàn thành.</p>
            </div>
            {tasksQuery.data && <strong>{tasksQuery.data.length} công việc</strong>}
          </div>
          {statusError && (
            <p className="error" role="alert">
              {statusError}
            </p>
          )}
          {tasksQuery.isPending ? (
            <p role="status">Đang tải công việc…</p>
          ) : tasksQuery.isError ? (
            <div role="alert">
              <strong>Chưa thể tải công việc</strong>
              <p>Kiểm tra kết nối rồi thử lại.</p>
              <button type="button" onClick={() => void tasksQuery.refetch()}>
                Thử lại
              </button>
            </div>
          ) : tasksQuery.data.length === 0 ? (
            <div>
              <strong>Chưa có công việc được giao</strong>
              <p>Công việc mới được giao cho bạn sẽ xuất hiện tại đây.</p>
            </div>
          ) : (
            <div className="task-list">
              {tasksQuery.data.map((task) => {
                const updatingThisTask =
                  statusMutation.isPending && statusMutation.variables?.task.id === task.id;
                const completingThisTask = completionTaskId === task.id;
                return (
                  <article className="task-item" key={task.id}>
                    <div className="task-item-heading">
                      <div>
                        <h3>{task.title}</h3>
                        <div className="task-item-meta">
                          <span>Ưu tiên {priorityLabels[task.priority].toLowerCase()}</span>
                          {task.dueAt && (
                            <span>Hạn {formatDueAtPreview(toLocalDateValue(task.dueAt))}</span>
                          )}
                          {task.sourceMeetingId && (
                            <Link to={`/app/meetings/${task.sourceMeetingId}`}>
                              Mở cuộc họp nguồn
                            </Link>
                          )}
                        </div>
                      </div>
                      <StatusBadge>{statusLabels[task.status]}</StatusBadge>
                    </div>
                    {task.completionNote && (
                      <div className="task-completion-result">
                        <strong>
                          {task.status === TaskStatus.DONE
                            ? 'Kết quả hoàn thành'
                            : 'Kết quả lần hoàn thành trước'}
                        </strong>
                        <p>{task.completionNote}</p>
                        <div>
                          {task.completedAt && (
                            <span>Ghi nhận lúc {formatDateTime(task.completedAt)}</span>
                          )}
                          {task.completionEvidenceUrl && (
                            <a
                              href={task.completionEvidenceUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              Mở minh chứng
                            </a>
                          )}
                        </div>
                      </div>
                    )}
                    <div className="task-status-actions">
                      {task.status === TaskStatus.TODO && (
                        <button
                          type="button"
                          disabled={statusMutation.isPending}
                          onClick={() => changeTaskStatus(task, TaskStatus.DOING)}
                        >
                          {updatingThisTask ? 'Đang cập nhật…' : 'Bắt đầu công việc'}
                        </button>
                      )}
                      {task.status === TaskStatus.DOING && !completingThisTask && (
                        <button
                          type="button"
                          disabled={statusMutation.isPending}
                          onClick={() => {
                            setCompletionTaskId(task.id);
                            setCompletionNote('');
                            setCompletionEvidenceUrl('');
                            setCompletionError('');
                          }}
                        >
                          Ghi nhận hoàn thành
                        </button>
                      )}
                      {task.status === TaskStatus.DONE && (
                        <button
                          type="button"
                          className="button-secondary"
                          disabled={statusMutation.isPending}
                          onClick={() => changeTaskStatus(task, TaskStatus.DOING)}
                        >
                          {updatingThisTask ? 'Đang cập nhật…' : 'Tiếp tục thực hiện'}
                        </button>
                      )}
                    </div>
                    {task.status === TaskStatus.DOING && completingThisTask && (
                      <div className="task-completion-form">
                        <div>
                          <strong>Ghi nhận kết quả</strong>
                          <p>
                            Mô tả kết quả là bắt buộc. Bạn có thể đính kèm liên kết tài liệu hoặc
                            bản demo.
                          </p>
                        </div>
                        <label>
                          Kết quả đã hoàn thành
                          <textarea
                            value={completionNote}
                            onChange={(event) => {
                              setCompletionNote(event.target.value);
                              setCompletionError('');
                            }}
                            maxLength={2000}
                            rows={3}
                            placeholder="Ví dụ: Đã hoàn thiện luồng đăng nhập và kiểm tra trên production."
                            required
                          />
                        </label>
                        <label>
                          Liên kết minh chứng <span>(không bắt buộc)</span>
                          <input
                            type="url"
                            value={completionEvidenceUrl}
                            onChange={(event) => {
                              setCompletionEvidenceUrl(event.target.value);
                              setCompletionError('');
                            }}
                            placeholder="https://..."
                          />
                        </label>
                        {completionError && (
                          <p className="error" role="alert">
                            {completionError}
                          </p>
                        )}
                        <div className="task-completion-actions">
                          <button
                            type="button"
                            disabled={statusMutation.isPending}
                            onClick={() => completeTask(task)}
                          >
                            {updatingThisTask ? 'Đang lưu…' : 'Xác nhận hoàn thành'}
                          </button>
                          <button
                            type="button"
                            className="button-secondary"
                            disabled={statusMutation.isPending}
                            onClick={() => {
                              setCompletionTaskId('');
                              setCompletionError('');
                            }}
                          >
                            Hủy
                          </button>
                        </div>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </FeaturePage>
  );
};
