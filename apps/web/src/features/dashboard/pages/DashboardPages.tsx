import { FeaturePage } from '../../../components/FeaturePage';
import { mockMeetings, mockNotifications, mockTasks } from '../../../mocks/data';

export const AppIndexPage = () => (
  <FeaturePage
    title="Không gian làm việc"
    description="Điểm vào ứng dụng CampusMeet."
    todo="M1 nối redirect theo trạng thái đăng nhập."
  />
);

export const DashboardPage = () => (
  <FeaturePage
    title="Tổng quan cá nhân"
    description="Cuộc họp, công việc và thông báo cần chú ý."
    todo="M2/M3 nối DashboardResponse từ API."
  >
    <div className="card-grid">
      <article>
        <strong>Cuộc họp sắp tới</strong>
        <span>{mockMeetings.length}</span>
      </article>
      <article>
        <strong>Công việc đang làm</strong>
        <span>{mockTasks.length}</span>
      </article>
      <article>
        <strong>Thông báo chưa đọc</strong>
        <span>{mockNotifications.filter((notification) => !notification.read).length}</span>
      </article>
    </div>
  </FeaturePage>
);
