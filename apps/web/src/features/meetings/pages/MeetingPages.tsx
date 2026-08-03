import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { MeetingStatus, type CreateMeetingRequest, type Meeting } from '@campusmeet/shared';
import { FeaturePage } from '../../../components/FeaturePage';
import { StatusBadge } from '../../../components/ui';
import { meetingService } from '../service';

const groupKey = (id: string) => ['meetings', 'group', id] as const;
const detailKey = (id: string) => ['meetings', 'detail', id] as const;
const local = (iso: string) => {
  const d = new Date(iso);
  return new Date(d.valueOf() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
type Values = {
  title: string;
  description: string;
  organizerId: string;
  attendeeIds: string;
  startsAt: string;
  endsAt: string;
  status: MeetingStatus.DRAFT | MeetingStatus.SCHEDULED;
  agenda: Array<{ id?: string; title: string }>;
};
const empty = (): Values => ({
  title: '',
  description: '',
  organizerId: '',
  attendeeIds: '',
  startsAt: local(new Date(Date.now() + 3600000).toISOString()),
  endsAt: local(new Date(Date.now() + 7200000).toISOString()),
  status: MeetingStatus.SCHEDULED,
  agenda: [{ title: '' }],
});
const payload = (groupId: string, v: Values): CreateMeetingRequest => ({
  groupId,
  title: v.title,
  ...(v.description ? { description: v.description } : {}),
  organizerId: v.organizerId,
  attendeeIds: v.attendeeIds
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean),
  startsAt: new Date(v.startsAt).toISOString(),
  endsAt: new Date(v.endsAt).toISOString(),
  status: v.status,
  agenda: v.agenda
    .filter((x) => x.title.trim())
    .map((x, order) => ({ ...x, title: x.title.trim(), order })),
});

function MeetingForm({
  groupId,
  existing,
  onDone,
}: {
  groupId: string;
  existing?: Meeting;
  onDone?: () => void;
}) {
  const qc = useQueryClient(),
    nav = useNavigate();
  const [v, setV] = useState<Values>(() =>
    existing
      ? {
          title: existing.title,
          description: existing.description ?? '',
          organizerId: existing.organizerId,
          attendeeIds: existing.attendeeIds.join(', '),
          startsAt: local(existing.startsAt),
          endsAt: local(existing.endsAt),
          status:
            existing.status === MeetingStatus.DRAFT ? MeetingStatus.DRAFT : MeetingStatus.SCHEDULED,
          agenda: existing.agenda.map((x) => ({ id: x.id, title: x.title })),
        }
      : empty(),
  );
  const change = <K extends keyof Values>(k: K, value: Values[K]) =>
    setV((old) => ({ ...old, [k]: value }));
  const mutation = useMutation({
    mutationFn: () => {
      const body = payload(groupId, v);
      return existing
        ? meetingService.update(existing.id, {
            title: body.title,
            description: body.description,
            organizerId: body.organizerId,
            attendeeIds: body.attendeeIds,
            agenda: body.agenda,
            startsAt: body.startsAt,
            endsAt: body.endsAt,
            status: body.status,
            version: existing.version,
          })
        : meetingService.create(body);
    },
    onSuccess: async (r) => {
      await qc.invalidateQueries({ queryKey: groupKey(groupId) });
      await qc.invalidateQueries({ queryKey: detailKey(r.data.meeting.id) });
      if (existing) onDone?.();
      else nav(`/app/meetings/${r.data.meeting.id}`);
    },
  });
  const invalid = new Date(v.endsAt) <= new Date(v.startsAt);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!invalid) mutation.mutate();
  };
  return (
    <form
      className="meeting-form"
      onSubmit={submit}
      aria-label={existing ? 'Sửa cuộc họp' : 'Tạo cuộc họp'}
    >
      <label>
        Tiêu đề
        <input required value={v.title} onChange={(e) => change('title', e.target.value)} />
      </label>
      <label>
        Mô tả
        <textarea value={v.description} onChange={(e) => change('description', e.target.value)} />
      </label>
      <label>
        Organizer (user ID)
        <input
          required
          value={v.organizerId}
          onChange={(e) => change('organizerId', e.target.value)}
        />
      </label>
      <label>
        Attendees (các user ID cách nhau bằng dấu phẩy)
        <input value={v.attendeeIds} onChange={(e) => change('attendeeIds', e.target.value)} />
      </label>
      <label>
        Bắt đầu
        <input
          required
          type="datetime-local"
          value={v.startsAt}
          onChange={(e) => change('startsAt', e.target.value)}
        />
      </label>
      <label>
        Kết thúc
        <input
          required
          type="datetime-local"
          min={v.startsAt}
          value={v.endsAt}
          onChange={(e) => change('endsAt', e.target.value)}
        />
      </label>
      <label>
        Trạng thái
        <select
          value={v.status}
          onChange={(e) => change('status', e.target.value as Values['status'])}
        >
          <option value={MeetingStatus.DRAFT}>Nháp</option>
          <option value={MeetingStatus.SCHEDULED}>Đã lên lịch</option>
        </select>
      </label>
      <fieldset>
        <legend>Agenda</legend>
        {v.agenda.map((item, i) => (
          <div className="agenda-row" key={item.id ?? i}>
            <label>
              Mục {i + 1}
              <input
                value={item.title}
                onChange={(e) =>
                  change(
                    'agenda',
                    v.agenda.map((x, n) => (n === i ? { ...x, title: e.target.value } : x)),
                  )
                }
              />
            </label>
            <button
              type="button"
              className="button-secondary"
              onClick={() =>
                change(
                  'agenda',
                  v.agenda.filter((_, n) => n !== i),
                )
              }
            >
              Xóa
            </button>
          </div>
        ))}
        <button
          type="button"
          className="button-secondary"
          onClick={() => change('agenda', [...v.agenda, { title: '' }])}
        >
          Thêm agenda
        </button>
      </fieldset>
      {invalid && (
        <p className="error" role="alert">
          Thời gian kết thúc phải sau thời gian bắt đầu.
        </p>
      )}
      {mutation.error && (
        <p className="error" role="alert">
          {mutation.error.message}
        </p>
      )}
      <button disabled={mutation.isPending || invalid}>
        {mutation.isPending ? 'Đang lưu…' : existing ? 'Lưu thay đổi' : 'Tạo cuộc họp'}
      </button>
    </form>
  );
}

export function GroupMeetingsPage() {
  const { groupId = '' } = useParams(),
    [cursor, setCursor] = useState<string>(),
    [form, setForm] = useState(false);
  const q = useQuery({
    queryKey: [...groupKey(groupId), cursor],
    queryFn: () => meetingService.list(groupId, cursor),
    enabled: Boolean(groupId),
  });
  return (
    <FeaturePage
      title="Lịch họp của nhóm"
      description={`Danh sách cuộc họp thuộc nhóm ${groupId}.`}
    >
      <button onClick={() => setForm((x) => !x)} aria-expanded={form}>
        {form ? 'Đóng biểu mẫu' : 'Tạo cuộc họp'}
      </button>
      {form && <MeetingForm groupId={groupId} />}{' '}
      {q.isLoading && <p className="state">Đang tải lịch họp…</p>}
      {q.error && (
        <p className="state error" role="alert">
          {q.error.message}
        </p>
      )}
      {q.data?.data.items.length === 0 && <p className="state">Nhóm chưa có cuộc họp.</p>}
      <div className="list">
        {q.data?.data.items.map((m) => (
          <article key={m.id}>
            <Link to={`/app/meetings/${m.id}`}>
              <strong>{m.title}</strong>
            </Link>{' '}
            <StatusBadge>{m.status}</StatusBadge>
            <p>{new Date(m.startsAt).toLocaleString('vi-VN')}</p>
          </article>
        ))}
      </div>
      <div className="actions">
        {cursor && (
          <button className="button-secondary" onClick={() => setCursor(undefined)}>
            Trang đầu
          </button>
        )}
        {q.data?.data.nextCursor && (
          <button onClick={() => setCursor(q.data?.data.nextCursor)}>Trang sau</button>
        )}
      </div>
    </FeaturePage>
  );
}

export function MeetingDetailPage() {
  const { meetingId = '' } = useParams(),
    qc = useQueryClient(),
    [editing, setEditing] = useState(false);
  const q = useQuery({
    queryKey: detailKey(meetingId),
    queryFn: () => meetingService.detail(meetingId),
    enabled: Boolean(meetingId),
  });
  const m = q.data?.data.meeting;
  const cancel = useMutation({
    mutationFn: () => meetingService.cancel(meetingId, { version: m?.version }),
    onSuccess: () => qc.invalidateQueries({ queryKey: detailKey(meetingId) }),
  });
  return (
    <FeaturePage title="Chi tiết cuộc họp" description="Agenda, organizer và người tham dự.">
      {q.isLoading && <p className="state">Đang tải cuộc họp…</p>}
      {q.error && (
        <p className="state error" role="alert">
          {q.error.message}
        </p>
      )}
      {m && (
        <>
          {editing ? (
            <MeetingForm groupId={m.groupId} existing={m} onDone={() => setEditing(false)} />
          ) : (
            <article className="meeting-detail">
              <StatusBadge>{m.status}</StatusBadge>
              <h2>{m.title}</h2>
              <p>{m.description}</p>
              <dl>
                <dt>Thời gian</dt>
                <dd>
                  {new Date(m.startsAt).toLocaleString('vi-VN')} –{' '}
                  {new Date(m.endsAt).toLocaleString('vi-VN')}
                </dd>
                <dt>Organizer</dt>
                <dd>{m.organizerId}</dd>
                <dt>Attendees</dt>
                <dd>{m.attendeeIds.join(', ') || 'Không có'}</dd>
              </dl>
              <h3>Agenda</h3>
              {m.agenda.length ? (
                <ol>
                  {m.agenda.map((a) => (
                    <li key={a.id}>{a.title}</li>
                  ))}
                </ol>
              ) : (
                <p>Chưa có agenda.</p>
              )}
            </article>
          )}
          <div className="actions">
            {m.status !== MeetingStatus.CANCELLED && m.status !== MeetingStatus.COMPLETED && (
              <>
                <button className="button-secondary" onClick={() => setEditing((x) => !x)}>
                  {editing ? 'Đóng chỉnh sửa' : 'Sửa'}
                </button>
                <button
                  disabled={cancel.isPending}
                  onClick={() => {
                    if (window.confirm('Bạn chắc chắn muốn hủy cuộc họp?')) cancel.mutate();
                  }}
                >
                  {cancel.isPending ? 'Đang hủy…' : 'Hủy cuộc họp'}
                </button>
              </>
            )}
          </div>
          {cancel.error && (
            <p className="error" role="alert">
              {cancel.error.message}
            </p>
          )}
        </>
      )}
    </FeaturePage>
  );
}
