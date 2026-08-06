import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type {
  CreateMeetingRequest,
  GroupDetails,
  Meeting,
  MeetingMinutes,
  UpdateMeetingMinutesRequest,
} from '@campusmeet/shared';
import { useAuth } from '../../../auth/AuthProvider';
import { FeaturePage } from '../../../components/FeaturePage';
import { ApiClientError } from '../../../lib/api-client';
import { MeetingAIWorkspace } from '../../ai';
import { getGroup } from '../../groups/service';
import {
  cancelMeeting,
  createMeeting,
  getMeeting,
  getMeetingMinutes,
  getMeetings,
  updateMeeting,
  updateMeetingMinutes,
} from '../service';
import './MeetingPages.css';

const statusLabel: Record<string, string> = {
  SCHEDULED: 'Đã lên lịch',
  READY: 'Sẵn sàng',
  CANCELLED: 'Đã hủy',
  COMPLETED: 'Đã kết thúc',
  INTEGRATION_PENDING: 'Đang đồng bộ',
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

function MinutesEditor({
  meetingId,
  initial,
  group,
  queryKey,
}: {
  meetingId: string;
  initial?: MeetingMinutes;
  group: GroupDetails;
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

  return (
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
  const [attendeeIds, setAttendeeIds] = useState(initial?.attendeeIds ?? []);
  const [agenda, setAgenda] = useState<AgendaDraft[]>(() =>
    [...(initial?.agenda ?? [])].sort((a, b) => a.order - b.order).map(createAgendaDraft),
  );
  const [agendaErrors, setAgendaErrors] = useState<Record<string, string>>({});

  const submit = (event: FormEvent) => {
    event.preventDefault();
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
      title,
      ...(description.trim() ? { description } : {}),
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
          onChange={(event) => setTitle(event.target.value)}
          minLength={2}
          maxLength={150}
          required
        />
      </label>
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
        <p className="meeting-field-error" role="alert">
          {timeError}
        </p>
      )}
      <label>
        Nội dung <span>(không bắt buộc)</span>
        <textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={3}
          maxLength={2000}
        />
      </label>
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
  const meetingsQuery = useQuery({
    queryKey: ['groups', groupId, 'meetings'],
    queryFn: () => getMeetings(groupId),
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
      [...(meetingsQuery.data ?? [])].sort(
        (a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt),
      ),
    [meetingsQuery.data],
  );
  const upcoming = meetings.filter(
    (meeting) => meeting.status !== 'CANCELLED' && Date.parse(meeting.endsAt) >= Date.now(),
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
              error={mutation.isError ? mutation.error.message : undefined}
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
  useEffect(() => {
    setConflictMessage('');
    setReloadError('');
    setReloadSuccess('');
    setIsReloading(false);
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
      updateMeeting(meetingId, { ...input, version: query.data?.version }),
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
    mutationFn: () => cancelMeeting(meetingId, { version: query.data?.version }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['meetings', meetingId] }),
        queryClient.invalidateQueries({ queryKey: ['groups', query.data?.groupId, 'meetings'] }),
      ]);
    },
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
          <strong>{query.error.message}</strong>
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
        </section>
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
                queryKey={minutesQueryKey}
              />
            )}
          {(minutesMissing || minutesQuery.data) &&
            isAdmin &&
            meeting.status === 'CANCELLED' && (
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
                      ? updateMutation.error.message
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
                  </div>
                  <button
                    className="button-danger-quiet"
                    type="button"
                    disabled={cancelMutation.isPending}
                    onClick={() => window.confirm('Hủy cuộc họp này?') && cancelMutation.mutate()}
                  >
                    Hủy cuộc họp
                  </button>
                </div>
                {cancelMutation.isError && (
                  <p className="error" role="alert">
                    {cancelMutation.error.message}
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
