import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { FeaturePage } from '../../../components/FeaturePage';
import {
  getInvitation,
  getMyInvitations,
  respondDirectInvitation,
  respondInvitation,
} from '../service';
import './InvitationPage.css';

const formatExpiry = (value: string) =>
  new Intl.DateTimeFormat('vi-VN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));

export function InvitationInboxPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ['invitations'], queryFn: getMyInvitations });
  const mutation = useMutation({
    mutationFn: ({ id, response }: { id: string; response: 'accept' | 'decline' }) =>
      respondDirectInvitation(id, response),
    onSuccess: async (invitation) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['invitations'] }),
        queryClient.invalidateQueries({ queryKey: ['groups'] }),
        queryClient.invalidateQueries({ queryKey: ['notifications'] }),
      ]);
      if (invitation.status === 'ACCEPTED') navigate(`/app/groups/${invitation.groupId}`);
    },
  });
  const invitationId = searchParams.get('invitationId');
  const invitations = invitationId
    ? (query.data ?? []).filter(({ id }) => id === invitationId)
    : (query.data ?? []);

  return (
    <FeaturePage
      title="Lời mời"
      description="Xem và phản hồi lời mời tham gia nhóm ngay trong CampusMeet."
    >
      {query.isPending ? (
        <div className="invitation-skeleton" role="status" aria-label="Đang tải lời mời">
          <span />
          <span />
        </div>
      ) : query.isError ? (
        <div className="state state-error" role="alert">
          <strong>Chưa tải được lời mời</strong>
          <p>Kiểm tra kết nối rồi thử lại.</p>
          <button type="button" onClick={() => void query.refetch()}>
            Thử lại
          </button>
        </div>
      ) : invitationId && !invitations.length ? (
        <div className="state invitation-empty">
          <strong>Lời mời không còn chờ phản hồi</strong>
          <p>Lời mời này đã được chấp nhận, từ chối, thu hồi hoặc đã hết hạn.</p>
          <Link className="button button-secondary" to="/app/invitations">
            Xem lời mời đang chờ
          </Link>
        </div>
      ) : invitations.length ? (
        <div className="invitation-inbox">
          {invitations.map((invitation) => (
            <article className="app-panel invitation-inbox-card" key={invitation.id}>
              <div>
                <span className="section-kicker">Lời mời tham gia nhóm</span>
                <h2>{invitation.groupName}</h2>
                <p>
                  Dành cho <strong>{invitation.email}</strong> · Hết hạn{' '}
                  {formatExpiry(invitation.expiresAt)}
                </p>
              </div>
              <div className="actions">
                <button
                  type="button"
                  disabled={mutation.isPending}
                  onClick={() => mutation.mutate({ id: invitation.id, response: 'accept' })}
                >
                  Chấp nhận
                </button>
                <button
                  className="button-secondary"
                  type="button"
                  disabled={mutation.isPending}
                  onClick={() => mutation.mutate({ id: invitation.id, response: 'decline' })}
                >
                  Từ chối
                </button>
              </div>
            </article>
          ))}
          {mutation.isError && (
            <p className="error" role="alert">
              {mutation.error.message}
            </p>
          )}
        </div>
      ) : (
        <div className="state invitation-empty">
          <strong>Bạn không có lời mời đang chờ</strong>
          <p>Khi một nhóm mời đúng email tài khoản này, lời mời sẽ xuất hiện tại đây.</p>
        </div>
      )}
    </FeaturePage>
  );
}

export function InvitationPage() {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['invitation', token],
    queryFn: () => getInvitation(token),
    enabled: Boolean(token),
  });
  const mutation = useMutation({
    mutationFn: (response: 'accept' | 'decline') => respondInvitation(token, response),
    onSuccess: async (invitation) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['groups'] }),
        queryClient.invalidateQueries({ queryKey: ['notifications'] }),
      ]);
      navigate(
        invitation.status === 'ACCEPTED' ? `/app/groups/${invitation.groupId}` : '/app/dashboard',
      );
    },
  });

  return (
    <FeaturePage
      title="Lời mời tham gia nhóm"
      description="Kiểm tra thông tin trước khi phản hồi."
      backTo="/app/invitations"
      backLabel="Quay lại"
    >
      {query.isPending ? (
        <div className="state">Đang kiểm tra lời mời…</div>
      ) : query.isError ? (
        <div className="state state-error" role="alert">
          <strong>Không thể mở lời mời</strong>
          <p>{query.error.message}</p>
        </div>
      ) : (
        <section className="app-panel invitation-card">
          <span className="status-badge">
            {query.data.status === 'PENDING' ? 'Đang chờ phản hồi' : 'Đã xử lý'}
          </span>
          <h2>{query.data.groupName}</h2>
          <p>
            Lời mời dành cho <strong>{query.data.email}</strong>.
          </p>
          <p>Hết hạn: {formatExpiry(query.data.expiresAt)}</p>
          {query.data.status === 'PENDING' && (
            <div className="actions">
              <button
                type="button"
                disabled={mutation.isPending}
                onClick={() => mutation.mutate('accept')}
              >
                Chấp nhận
              </button>
              <button
                className="button-secondary"
                type="button"
                disabled={mutation.isPending}
                onClick={() => mutation.mutate('decline')}
              >
                Từ chối
              </button>
            </div>
          )}
          {mutation.isError && (
            <p className="error" role="alert">
              {mutation.error.message}
            </p>
          )}
        </section>
      )}
    </FeaturePage>
  );
}
