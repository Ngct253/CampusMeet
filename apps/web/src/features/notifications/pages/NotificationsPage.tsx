import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { FeaturePage } from '../../../components/FeaturePage';
import { getNotifications, markNotificationRead } from '../service';
import './NotificationsPage.css';

const formatDate = (value: string) =>
  new Intl.DateTimeFormat('vi-VN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));

const typeLabel = (type: string) => {
  if (type === 'INVITATION') return 'Lời mời';
  if (type === 'MEETING_REMINDER') return 'Cuộc họp';
  if (type === 'TASK_ASSIGNED') return 'Công việc';
  return 'Hệ thống';
};

export function NotificationsPage() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<'unread' | 'all'>('unread');
  const query = useQuery({ queryKey: ['notifications'], queryFn: getNotifications });
  const mutation = useMutation({
    mutationFn: markNotificationRead,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });
  const notifications = query.data ?? [];
  const unreadCount = notifications.filter(({ read }) => !read).length;
  const visibleNotifications =
    filter === 'unread' ? notifications.filter(({ read }) => !read) : notifications;

  return (
    <FeaturePage
      title="Thông báo"
      description="Theo dõi những cập nhật cần bạn chú ý trong CampusMeet."
    >
      {query.isPending ? (
        <div className="notification-skeleton" role="status" aria-label="Đang tải thông báo">
          <span />
          <span />
          <span />
        </div>
      ) : query.isError ? (
        <div className="state state-error" role="alert">
          <strong>Chưa tải được thông báo</strong>
          <p>Kiểm tra kết nối rồi thử lại.</p>
          <button type="button" onClick={() => void query.refetch()}>
            Thử lại
          </button>
        </div>
      ) : notifications.length ? (
        <section className="notification-center" aria-label="Hộp thư thông báo">
          <div className="notification-filters" role="tablist" aria-label="Lọc thông báo">
            <button
              type="button"
              role="tab"
              aria-selected={filter === 'unread'}
              onClick={() => setFilter('unread')}
            >
              Chưa đọc <span>{unreadCount}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={filter === 'all'}
              onClick={() => setFilter('all')}
            >
              Tất cả <span>{notifications.length}</span>
            </button>
          </div>

          {visibleNotifications.length ? (
            <div className="notification-inbox">
              {visibleNotifications.map((notification) => {
                const content = (
                  <>
                    <span className="notification-dot" aria-hidden="true" />
                    <span className="notification-copy">
                      <span className="notification-meta">
                        <span>{typeLabel(notification.type)}</span>
                        <time dateTime={notification.createdAt}>
                          {formatDate(notification.createdAt)}
                        </time>
                      </span>
                      <strong>{notification.title}</strong>
                      {notification.actionUrl && <small>Xem chi tiết</small>}
                    </span>
                  </>
                );
                return (
                  <article
                    key={notification.id}
                    className={notification.read ? 'is-read' : 'is-unread'}
                  >
                    {notification.actionUrl ? (
                      <Link
                        className="notification-content"
                        to={notification.actionUrl}
                        onClick={() => {
                          if (!notification.read) mutation.mutate(notification.id);
                        }}
                      >
                        {content}
                      </Link>
                    ) : !notification.read ? (
                      <button
                        className="notification-content"
                        type="button"
                        disabled={mutation.isPending}
                        onClick={() => mutation.mutate(notification.id)}
                      >
                        {content}
                      </button>
                    ) : (
                      <div className="notification-content">{content}</div>
                    )}
                  </article>
                );
              })}
              {mutation.isError && (
                <p className="error" role="alert">
                  {mutation.error.message}
                </p>
              )}
            </div>
          ) : (
            <div className="notification-empty">
              <strong>Bạn đã xem hết thông báo</strong>
              <p>Thông báo mới cần chú ý sẽ xuất hiện tại đây.</p>
            </div>
          )}
        </section>
      ) : (
        <div className="state notification-empty">
          <strong>Chưa có thông báo</strong>
          <p>Lời mời nhóm, nhắc lịch và các cập nhật mới sẽ xuất hiện tại đây.</p>
        </div>
      )}
    </FeaturePage>
  );
}
