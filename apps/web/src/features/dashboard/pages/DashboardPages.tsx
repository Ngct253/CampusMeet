import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../../auth/AuthProvider';
import { FeaturePage } from '../../../components/FeaturePage';
import { getGroups } from '../../groups/service';
import { getMyMeetings } from '../../meetings/service';
import { getNotifications } from '../../notifications/service';
import { getProfile } from '../../settings/service';
import './DashboardPages.css';

function MetricCard({
  label,
  value,
  note,
  tone = 'blue',
}: {
  label: string;
  value: ReactNode;
  note: string;
  tone?: 'blue' | 'violet' | 'green' | 'amber';
}) {
  return (
    <article className={`metric-card metric-card-${tone}`}>
      <div className="metric-card-top">
        <span>{label}</span>
        <i aria-hidden="true" />
      </div>
      <strong>{value}</strong>
      <p>{note}</p>
    </article>
  );
}

function QueryValue<T>({
  query,
  children,
}: {
  query: UseQueryResult<T>;
  children: (data: T) => ReactNode;
}) {
  if (query.isPending) return <span className="skeleton skeleton-number" aria-label="Đang tải" />;
  if (query.isError) return <span aria-label="Chưa đồng bộ">—</span>;
  return children(query.data);
}

function PanelSkeleton() {
  return (
    <div className="panel-skeleton" role="status" aria-label="Đang tải dữ liệu">
      <span />
      <span />
      <span />
    </div>
  );
}

function SyncNotice({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="sync-notice" role="alert">
      <span className="sync-notice-icon" aria-hidden="true">
        !
      </span>
      <div>
        <strong>Chưa thể đồng bộ dữ liệu</strong>
        <p>Kiểm tra kết nối rồi thử lại.</p>
      </div>
      <button className="button-quiet" type="button" onClick={onRetry}>
        Thử lại
      </button>
    </div>
  );
}

const formatMeetingTime = (startsAt: string) =>
  new Intl.DateTimeFormat('vi-VN', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(startsAt));

export function DashboardPage() {
  const auth = useAuth();
  const groupsQuery = useQuery({ queryKey: ['groups'], queryFn: getGroups });
  const meetingsQuery = useQuery({ queryKey: ['meetings'], queryFn: getMyMeetings });
  const notificationsQuery = useQuery({ queryKey: ['notifications'], queryFn: getNotifications });
  const profileQuery = useQuery({ queryKey: ['profile'], queryFn: getProfile });
  const identity =
    auth.status === 'authenticated' ? (auth.user.signInDetails?.loginId ?? auth.user.username) : '';
  const displayName = profileQuery.data?.displayName || identity.split('@')[0] || 'bạn';
  const groups = groupsQuery.data ?? [];
  const meetings = meetingsQuery.data ?? [];
  const unreadNotifications = (notificationsQuery.data ?? []).filter(
    (notification) => !notification.read,
  );

  return (
    <FeaturePage
      title={`Chào ${displayName}`}
      description="Mọi thông tin cần thiết trước, trong và sau cuộc họp — ở cùng một nơi."
    >
      <div className="dashboard-summary" aria-label="Tóm tắt tài khoản">
        <MetricCard
          label="Nhóm của bạn"
          tone="blue"
          note="Không gian đang tham gia"
          value={<QueryValue query={groupsQuery}>{(data) => data.length}</QueryValue>}
        />
        <MetricCard
          label="Cuộc họp"
          tone="violet"
          note="Lịch họp được đồng bộ"
          value={<QueryValue query={meetingsQuery}>{(data) => data.length}</QueryValue>}
        />
        <MetricCard
          label="Chưa đọc"
          tone="amber"
          note="Thông báo cần chú ý"
          value={
            <QueryValue query={notificationsQuery}>
              {(data) => data.filter((item) => !item.read).length}
            </QueryValue>
          }
        />
        <MetricCard
          label="Tài khoản"
          tone="green"
          note={profileQuery.isError ? 'Hồ sơ chưa đồng bộ' : 'Phiên đăng nhập an toàn'}
          value="Đã xác thực"
        />
      </div>

      <div className="dashboard-grid">
        <section className="dashboard-panel dashboard-meetings">
          <header>
            <div>
              <span className="section-kicker">Lịch của bạn</span>
              <h2>Cuộc họp sắp tới</h2>
              <p>Chuẩn bị nội dung và vào cuộc họp đúng giờ.</p>
            </div>
          </header>
          {meetingsQuery.isPending ? (
            <PanelSkeleton />
          ) : meetingsQuery.isError ? (
            <SyncNotice onRetry={() => void meetingsQuery.refetch()} />
          ) : meetings.length ? (
            <div className="meeting-list">
              {meetings.slice(0, 4).map((meeting) => (
                <Link key={meeting.id} to={`/app/meetings/${meeting.id}`}>
                  <span className="meeting-date" aria-hidden="true">
                    {new Date(meeting.startsAt).getDate()}
                  </span>
                  <span className="meeting-copy">
                    <strong>{meeting.title}</strong>
                    <small>{formatMeetingTime(meeting.startsAt)}</small>
                  </span>
                  <span className="row-arrow" aria-hidden="true">
                    →
                  </span>
                </Link>
              ))}
            </div>
          ) : (
            <div className="inline-empty">
              <strong>Chưa có cuộc họp sắp tới</strong>
              <p>Lịch họp mới sẽ xuất hiện ở đây khi được tạo cho nhóm của bạn.</p>
            </div>
          )}
        </section>

        <section className="dashboard-panel">
          <header>
            <div>
              <span className="section-kicker">Cộng tác</span>
              <h2>Nhóm gần đây</h2>
              <p>Mở nhanh không gian bạn đang làm việc.</p>
            </div>
            <Link to="/app/groups">Xem tất cả</Link>
          </header>
          {groupsQuery.isPending ? (
            <PanelSkeleton />
          ) : groupsQuery.isError ? (
            <SyncNotice onRetry={() => void groupsQuery.refetch()} />
          ) : groups.length ? (
            <div className="compact-list">
              {groups.slice(0, 3).map((group) => (
                <Link key={group.id} to={`/app/groups/${group.id}`}>
                  <span className="group-initial" aria-hidden="true">
                    {group.name.charAt(0).toUpperCase()}
                  </span>
                  <span>
                    <strong>{group.name}</strong>
                    <small>{group.description || 'Chưa có mô tả nhóm'}</small>
                  </span>
                  <span className="status-badge">
                    {group.role === 'GROUP_ADMIN' ? 'Quản trị viên' : 'Thành viên'}
                  </span>
                </Link>
              ))}
            </div>
          ) : (
            <div className="inline-empty">
              <strong>Bạn chưa có nhóm nào</strong>
              <p>Tạo nhóm đầu tiên để bắt đầu quản lý cuộc họp cùng mọi người.</p>
              <Link to="/app/groups">Tạo nhóm</Link>
            </div>
          )}
        </section>

        <section className="dashboard-panel">
          <header>
            <div>
              <span className="section-kicker">Cập nhật</span>
              <h2>Cần chú ý</h2>
              <p>Lời mời và thay đổi mới nhất.</p>
            </div>
            <Link to="/app/notifications">Mở hộp thư</Link>
          </header>
          {notificationsQuery.isPending ? (
            <PanelSkeleton />
          ) : notificationsQuery.isError ? (
            <SyncNotice onRetry={() => void notificationsQuery.refetch()} />
          ) : unreadNotifications.length ? (
            <div className="compact-list notification-list">
              {unreadNotifications.slice(0, 3).map((notification) => (
                <Link key={notification.id} to={notification.actionUrl || '/app/notifications'}>
                  <span className="notification-dot" aria-hidden="true" />
                  <span>
                    <strong>{notification.title}</strong>
                    <small>Chưa đọc</small>
                  </span>
                  <span className="row-arrow" aria-hidden="true">
                    →
                  </span>
                </Link>
              ))}
            </div>
          ) : (
            <div className="inline-empty">
              <strong>Bạn đã xem hết thông báo</strong>
              <p>Các cập nhật mới sẽ xuất hiện tại đây.</p>
            </div>
          )}
        </section>
      </div>
    </FeaturePage>
  );
}
