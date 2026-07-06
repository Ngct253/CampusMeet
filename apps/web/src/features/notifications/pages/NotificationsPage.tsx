import { FeaturePage } from '../../../components/FeaturePage';
import { mockNotifications } from '../../../mocks/data';

export const NotificationsPage = () => (
  <FeaturePage
    title="Thông báo"
    description="Nhắc lịch, lời mời và thay đổi công việc."
    todo="M3/M5 nối notification API và email fallback."
  >
    <div className="list">
      {mockNotifications.map((notification) => (
        <article key={notification.id}>
          <strong>{notification.title}</strong>
          <p>MOCK DATA</p>
        </article>
      ))}
    </div>
  </FeaturePage>
);
