import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '../../../auth/AuthProvider';
import { FeaturePage } from '../../../components/FeaturePage';
import { getProfile, updateProfile } from '../service';
import './SettingsPage.css';

export function SettingsPage() {
  const auth = useAuth();
  const queryClient = useQueryClient();
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
            <small id="email-help">Email được xác minh và quản lý bởi Amazon Cognito.</small>
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
            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={emailNotificationsEnabled}
                onChange={(event) => setEmailNotificationsEnabled(event.target.checked)}
              />
              Nhận email bổ sung khi hệ thống hỗ trợ gửi email
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
    </FeaturePage>
  );
}
