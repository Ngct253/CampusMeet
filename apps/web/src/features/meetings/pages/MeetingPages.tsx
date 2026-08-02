import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { CreateMeetingRequest, GroupDetails, Meeting } from '@campusmeet/shared';
import { FeaturePage } from '../../../components/FeaturePage';
import { getGroup } from '../../groups/service';
import { cancelMeeting, createMeeting, getMeeting, getMeetings, updateMeeting } from '../service';
import './MeetingPages.css';

const statusLabel: Record<string, string> = {
  SCHEDULED: 'Đã lên lịch',
  READY: 'Sẵn sàng',
  CANCELLED: 'Đã hủy',
  COMPLETED: 'Đã kết thúc',
  INTEGRATION_PENDING: 'Đang đồng bộ',
};

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

const memberLabel = (group: GroupDetails | undefined, userId: string) => {
  const member = group?.members.find(({ membership }) => membership.userId === userId);
  return member?.user?.displayName || member?.user?.email || userId;
};

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
  const [startsAt, setStartsAt] = useState(initial ? toLocalInput(initial.startsAt) : '');
  const [endsAt, setEndsAt] = useState(initial ? toLocalInput(initial.endsAt) : '');
  const [attendeeIds, setAttendeeIds] = useState(initial?.attendeeIds ?? []);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit({
      title,
      ...(description.trim() ? { description } : {}),
      attendeeIds,
      startsAt: new Date(startsAt).toISOString(),
      endsAt: new Date(endsAt).toISOString(),
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
        <label>
          Bắt đầu
          <input
            type="datetime-local"
            value={startsAt}
            onChange={(event) => setStartsAt(event.target.value)}
            required
          />
        </label>
        <label>
          Kết thúc
          <input
            type="datetime-local"
            value={endsAt}
            min={startsAt}
            onChange={(event) => setEndsAt(event.target.value)}
            required
          />
        </label>
      </div>
      <label>
        Nội dung <span>(không bắt buộc)</span>
        <textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={3}
          maxLength={2000}
        />
      </label>
      <fieldset className="meeting-attendees">
        <legend>Người tham dự</legend>
        <div>
          {group.members.map(({ membership, user }) => (
            <label key={membership.userId}>
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
              <span>{user?.displayName || user?.email || membership.userId}</span>
            </label>
          ))}
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

  return (
    <FeaturePage
      title="Cuộc họp"
      description={
        groupQuery.data
          ? `Lịch làm việc chung của ${groupQuery.data.group.name}.`
          : 'Lịch làm việc chung của nhóm.'
      }
      backTo={`/app/groups/${groupId}`}
      backLabel="Quay lại"
    >
      <div className={`meeting-page-layout${isAdmin ? '' : ' meeting-page-layout-single'}`}>
        <section className="app-panel meeting-directory">
          <div className="section-heading meeting-directory-heading">
            <div>
              <span className="section-kicker">Lịch chung</span>
              <h2>Sắp tới</h2>
            </div>
            {!meetingsQuery.isPending && (
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
              <strong>Chưa tải được lịch họp</strong>
              <p>Kiểm tra kết nối rồi thử lại.</p>
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
  const queryClient = useQueryClient();
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
  const updateMutation = useMutation({
    mutationFn: (input: CreateMeetingRequest) => updateMeeting(meetingId, input),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['meetings', meetingId] }),
        queryClient.invalidateQueries({ queryKey: ['groups', query.data?.groupId, 'meetings'] }),
      ]);
    },
  });
  const cancelMutation = useMutation({
    mutationFn: () => cancelMeeting(meetingId),
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
      <FeaturePage
        title="Cuộc họp"
        description="Không thể mở cuộc họp."
        backTo="/app/groups"
        backLabel="Quay lại"
      >
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
  return (
    <FeaturePage
      title={meeting.title}
      description={formatDate(meeting.startsAt)}
      backTo={`/app/groups/${meeting.groupId}/meetings`}
      backLabel="Quay lại"
    >
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
        {isAdmin && groupQuery.data && meeting.status !== 'CANCELLED' && (
          <details className="app-panel meeting-admin-panel">
            <summary>Chỉnh sửa cuộc họp</summary>
            <div className="meeting-admin-content">
              <MeetingForm
                key={`${meeting.id}-${meeting.startsAt}`}
                group={groupQuery.data}
                initial={meeting}
                submitLabel="Lưu thay đổi"
                pending={updateMutation.isPending}
                error={updateMutation.isError ? updateMutation.error.message : undefined}
                onSubmit={(input) => updateMutation.mutate(input)}
              />
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
      </div>
    </FeaturePage>
  );
}
