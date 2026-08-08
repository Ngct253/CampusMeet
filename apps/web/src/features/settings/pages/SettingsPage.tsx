import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../../auth/AuthProvider';
import { FeaturePage } from '../../../components/FeaturePage';
import { connectGoogleCalendar, getProfile, updateProfile } from '../service';
import './SettingsPage.css';

export function SettingsPage() {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const query = useQuery({ queryKey: ['profile'], queryFn: getProfile });
  const [displayName, setDisplayName] = useState('');
  const [emailNotificationsEnabled, setEmailNotificationsEnabled] = useState(true);
  const sessionEmail =
    auth.status === 'authenticated' ? (auth.user.signInDetails?.loginId ?? '') : '';
  const mutation = useMutation({
    mutationFn: () =>
      updateProfile({
        displayName,
        timezone: query.data?.timezone ?? 'Asia/Ho_Chi_Minh',
        emailNotificationsEnabled,
      }),
    onSuccess: (profile) => queryClient.setQueryData(['profile'], profile),
  });
  const googleMutation = useMutation({
    mutationFn: connectGoogleCalendar,
    onSuccess: ({ authorizationUrl }) => window.location.assign(authorizationUrl),
  });
  const googleCallbackState = searchParams.get('google');
  const googleState = googleMutation.isPending
    ? 'Đang kết nối'
    : googleMutation.isError ||
        googleCallbackState === 'error' ||
        googleCallbackState === 'action-required'
      ? 'Cần kết nối lại'
      : googleCallbackState === 'connected'
        ? 'Đã kết nối'
        : 'Chưa kết nối';

  useEffect(() => {
    if (!query.data) return;
    setDisplayName(query.data.displayName || sessionEmail.split('@')[0] || sessionEmail);
    setEmailNotificationsEnabled(query.data.emailNotificationsEnabled);
  }, [query.data, sessionEmail]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    mutation.mutate();
  };

  return (
    <FeaturePage
      title="Cài đặt tài khoản"
      description="Thông tin cá nhân và cách CampusMeet gửi thông báo cho bạn."
    >
      {query.isPending ? (
        <div className="state">Đang tải hồ sơ…</div>
      ) : query.isError ? (
        <div className="state state-error" role="alert">
          <strong>{query.error.message}</strong>
          <button type="button" onClick={() => void query.refetch()}>
            Thử lại
          </button>
        </div>
      ) : (
        <section className="app-panel settings-panel">
          <form className="app-form" onSubmit={submit}>
            <label>
              Email
              <input
                value={query.data.email || sessionEmail}
                readOnly
                aria-describedby="email-help"
              />
            </label>
            <small id="email-help">Địa chỉ email đã được xác minh khi tạo tài khoản.</small>
            <label>
              Tên hiển thị
              <input
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                minLength={2}
                maxLength={100}
                required
              />
            </label>
            {mutation.isError && (
              <p className="error" role="alert">
                {mutation.error.message}
              </p>
            )}
            {mutation.isSuccess && (
              <p className="success" role="status">
                Đã lưu cài đặt.
              </p>
            )}
            <button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? 'Đang lưu…' : 'Lưu cài đặt'}
            </button>
          </form>
        </section>
      )}
      <section className="app-panel settings-panel settings-integration-panel">
        <div>
          <span className="section-kicker">Tích hợp</span>
          <h2>Google Calendar và Google Meet</h2>
          <p>
            Cho phép CampusMeet tạo sự kiện Calendar và liên kết phòng họp Google Meet thay mặt bạn.
          </p>
        </div>
        <ol className="settings-integration-steps">
          <li>Chọn “Kết nối Google”.</li>
          <li>Đăng nhập đúng tài khoản đã được cấp quyền kiểm thử.</li>
          <li>Cho phép CampusMeet truy cập Calendar; bạn sẽ được đưa trở lại trang này.</li>
        </ol>
        <p className="settings-integration-note">
          Bản thử nghiệm hiện chỉ chấp nhận tài khoản nằm trong danh sách người kiểm thử của Google.
          Nếu Google báo lỗi 403, quản trị viên Google Cloud cần thêm email của bạn vào danh sách
          này.
        </p>
        <p className={googleState === 'Đã kết nối' ? 'success' : undefined} role="status">
          Trạng thái: <strong>{googleState}</strong>
        </p>
        {googleMutation.isError && (
          <p className="error" role="alert">
            Chưa thể kết nối Google. Bạn có thể thử lại mà không ảnh hưởng đến lịch nội bộ.
          </p>
        )}
        <button
          type="button"
          disabled={googleMutation.isPending}
          onClick={() => googleMutation.mutate()}
        >
          {googleMutation.isPending
            ? 'Đang chuyển tới Google…'
            : googleState === 'Cần kết nối lại'
              ? 'Kết nối lại Google'
              : 'Kết nối Google Calendar'}
        </button>
      </section>
    </FeaturePage>
  );
}
