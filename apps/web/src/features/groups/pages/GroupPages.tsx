import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../../auth/AuthProvider';
import { FeaturePage } from '../../../components/FeaturePage';
import {
  createGroup,
  getGroup,
  getGroupInvitations,
  getGroups,
  inviteMember,
  removeMember,
  revokeInvitation,
  updateGroup,
} from '../service';
import './GroupPages.css';

const roleLabel = (role: string) => (role === 'GROUP_ADMIN' ? 'Quản trị viên' : 'Thành viên');

export function GroupsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ['groups'], queryFn: getGroups });
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const mutation = useMutation({
    mutationFn: () =>
      createGroup({ name, ...(description.trim() ? { description } : {}) }, crypto.randomUUID()),
    onSuccess: async (group) => {
      await queryClient.invalidateQueries({ queryKey: ['groups'] });
      navigate(`/app/groups/${group.id}`);
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    mutation.mutate();
  };

  return (
    <FeaturePage
      title="Nhóm của tôi"
      description="Không gian cộng tác cho thành viên, lịch họp và công việc chung."
    >
      <div className="group-page-layout">
        <section className="app-panel create-group-panel">
          <span className="section-kicker">Bắt đầu nhanh</span>
          <h2>Tạo nhóm mới</h2>
          <p>Đặt tên cho không gian làm việc. Bạn sẽ là Quản trị viên của nhóm.</p>
          <form className="app-form" onSubmit={submit}>
            <label>
              Tên nhóm
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                minLength={2}
                maxLength={100}
                required
              />
            </label>
            <label>
              Mô tả <span>(không bắt buộc)</span>
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                maxLength={500}
                rows={3}
              />
            </label>
            {mutation.isError && (
              <p className="error" role="alert">
                {mutation.error.message}
              </p>
            )}
            <button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? 'Đang tạo…' : 'Tạo nhóm'}
            </button>
          </form>
        </section>

        <section className="group-directory app-panel">
          <div className="group-directory-heading">
            <div>
              <span className="section-kicker">Không gian của bạn</span>
              <h2>Nhóm đang tham gia</h2>
            </div>
            {query.isSuccess && <span className="group-count">{query.data.length} nhóm</span>}
          </div>
          {query.isPending ? (
            <div className="group-list-skeleton" role="status" aria-label="Đang tải danh sách nhóm">
              <span />
              <span />
              <span />
            </div>
          ) : query.isError ? (
            <div className="group-sync-state" role="alert">
              <div className="sync-notice-icon" aria-hidden="true">
                !
              </div>
              <div>
                <strong>Danh sách nhóm chưa được đồng bộ</strong>
                <p>Không thể kết nối tới CampusMeet. Kiểm tra mạng rồi thử lại.</p>
              </div>
              <button className="button-quiet" type="button" onClick={() => void query.refetch()}>
                Thử lại
              </button>
            </div>
          ) : query.data.length ? (
            <div className="list group-list">
              {query.data.map((group) => (
                <Link key={group.id} to={`/app/groups/${group.id}`}>
                  <span>
                    <strong>{group.name}</strong>
                    <small>{group.description || 'Chưa có mô tả nhóm'}</small>
                  </span>
                  <span className="status-badge">{roleLabel(group.role)}</span>
                </Link>
              ))}
            </div>
          ) : (
            <div className="group-empty-state">
              <span className="empty-group-illustration" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              <strong>Bạn chưa có nhóm nào</strong>
              <p>Tạo nhóm đầu tiên bằng biểu mẫu bên cạnh hoặc tham gia qua liên kết lời mời.</p>
            </div>
          )}
        </section>
      </div>
    </FeaturePage>
  );
}

export function GroupDetailPage() {
  const { groupId = '' } = useParams();
  const auth = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const query = useQuery({
    queryKey: ['groups', groupId],
    queryFn: () => getGroup(groupId),
    enabled: Boolean(groupId),
  });
  const invitationsQuery = useQuery({
    queryKey: ['groups', groupId, 'invitations'],
    queryFn: () => getGroupInvitations(groupId),
    enabled: Boolean(groupId) && query.data?.group.role === 'GROUP_ADMIN',
  });
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteLink, setInviteLink] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const isAdmin = query.data?.group.role === 'GROUP_ADMIN';
  const currentUserId = auth.status === 'authenticated' ? auth.user.userId : '';

  useEffect(() => {
    if (!query.data) return;
    setName(query.data.group.name);
    setDescription(query.data.group.description ?? '');
  }, [query.data]);

  const inviteMutation = useMutation({
    mutationFn: () => inviteMember(groupId, inviteEmail),
    onSuccess: async ({ inviteToken }) => {
      setInviteLink(`${window.location.origin}/app/invitations/${inviteToken}`);
      setInviteEmail('');
      await queryClient.invalidateQueries({ queryKey: ['groups', groupId, 'invitations'] });
    },
  });
  const revokeMutation = useMutation({
    mutationFn: (invitationId: string) => revokeInvitation(groupId, invitationId),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['groups', groupId, 'invitations'] }),
  });
  const updateMutation = useMutation({
    mutationFn: () =>
      updateGroup(groupId, {
        name,
        ...(description ? { description } : {}),
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['groups'] }),
        queryClient.invalidateQueries({ queryKey: ['groups', groupId] }),
      ]);
    },
  });
  const removeMutation = useMutation({
    mutationFn: (userId: string) => removeMember(groupId, userId),
    onSuccess: async (_, userId) => {
      await queryClient.invalidateQueries({ queryKey: ['groups'] });
      if (userId === currentUserId) navigate('/app/groups');
      else await query.refetch();
    },
  });

  if (query.isPending)
    return (
      <FeaturePage
        title="Chi tiết nhóm"
        description="Đang tải thông tin nhóm…"
        backTo="/app/groups"
        backLabel="Quay lại"
      >
        <div className="state">Đang tải…</div>
      </FeaturePage>
    );
  if (query.isError)
    return (
      <FeaturePage
        title="Chi tiết nhóm"
        description="Không thể mở nhóm."
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

  const { group, members } = query.data;
  return (
    <FeaturePage
      title={group.name}
      description={group.description || 'Không gian thành viên và cuộc họp của nhóm.'}
      backTo="/app/groups"
      backLabel="Quay lại"
    >
      <div className="group-detail-layout">
        <section className="app-panel group-members-panel">
          <div className="section-heading">
            <div>
              <h2>Thành viên</h2>
              <p>{members.length} thành viên đang hoạt động</p>
            </div>
            <span className="status-badge">{roleLabel(group.role)}</span>
          </div>
          <div className="member-list">
            {members.map(({ membership, user }) => {
              const memberName = user?.displayName || user?.email || membership.userId;
              return (
                <article key={membership.id}>
                  <span className="member-identity">
                    <span className="member-avatar" aria-hidden="true">
                      {memberName.charAt(0).toUpperCase()}
                    </span>
                    <span>
                      <strong>{memberName}</strong>
                      <small>{user?.email || roleLabel(membership.role)}</small>
                    </span>
                  </span>
                  <span className="member-actions">
                    <span className="status-badge">{roleLabel(membership.role)}</span>
                    {isAdmin && membership.role !== 'GROUP_ADMIN' && (
                      <button
                        className="button-danger-quiet member-remove-button"
                        type="button"
                        disabled={removeMutation.isPending}
                        onClick={() => {
                          const label = user?.displayName || user?.email || 'thành viên này';
                          if (window.confirm(`Xóa ${label} khỏi nhóm?`))
                            removeMutation.mutate(membership.userId);
                        }}
                      >
                        Xóa
                      </button>
                    )}
                  </span>
                </article>
              );
            })}
          </div>
          {removeMutation.isError && (
            <p className="error" role="alert">
              {removeMutation.error.message}
            </p>
          )}
        </section>

        <section className="app-panel group-meeting-panel">
          <div>
            <span className="section-kicker">Lịch chung</span>
            <h2>Cuộc họp</h2>
            <p>Xem lịch và nội dung cuộc họp thuộc nhóm này.</p>
          </div>
          <Link className="button" to={`/app/groups/${group.id}/meetings`}>
            Xem cuộc họp
          </Link>
        </section>

        {isAdmin && (
          <section className="group-management-section">
            <div className="group-management-heading">
              <div>
                <span className="section-kicker">Dành cho quản trị viên</span>
                <h2>Quản lý nhóm</h2>
              </div>
              <p>Mời thành viên, theo dõi lời mời và cập nhật thông tin chung.</p>
            </div>
            <div className="group-management-grid">
              <section className="app-panel group-invite-panel">
                <h2>Mời thành viên</h2>
                <p>
                  Lời mời sẽ xuất hiện trực tiếp trong CampusMeet nếu người nhận đã có tài khoản.
                </p>
                <form
                  className="app-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    inviteMutation.mutate();
                  }}
                >
                  <label>
                    Email
                    <input
                      type="email"
                      value={inviteEmail}
                      onChange={(event) => setInviteEmail(event.target.value)}
                      required
                    />
                  </label>
                  {inviteMutation.isError && (
                    <p className="error" role="alert">
                      {inviteMutation.error.message}
                    </p>
                  )}
                  <button type="submit" disabled={inviteMutation.isPending}>
                    {inviteMutation.isPending ? 'Đang tạo lời mời…' : 'Tạo lời mời'}
                  </button>
                </form>
                {inviteLink && (
                  <div className="invite-result" role="status">
                    <strong>Đã gửi lời mời. Liên kết dự phòng có hiệu lực 7 ngày</strong>
                    <input readOnly value={inviteLink} aria-label="Liên kết mời" />
                    <button
                      className="button-secondary"
                      type="button"
                      onClick={() => void navigator.clipboard.writeText(inviteLink)}
                    >
                      Sao chép liên kết
                    </button>
                  </div>
                )}
              </section>

              <section className="app-panel group-settings-panel">
                <h2>Thông tin nhóm</h2>
                <form
                  className="app-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    updateMutation.mutate();
                  }}
                >
                  <label>
                    Tên nhóm
                    <input
                      value={name}
                      placeholder={group.name}
                      onChange={(event) => setName(event.target.value)}
                      minLength={2}
                      maxLength={100}
                    />
                  </label>
                  <label>
                    Mô tả
                    <textarea
                      value={description}
                      placeholder={group.description || 'Thêm mô tả'}
                      onChange={(event) => setDescription(event.target.value)}
                      rows={3}
                      maxLength={500}
                    />
                  </label>
                  {updateMutation.isError && (
                    <p className="error" role="alert">
                      {updateMutation.error.message}
                    </p>
                  )}
                  <button type="submit" disabled={updateMutation.isPending}>
                    {updateMutation.isPending ? 'Đang lưu…' : 'Lưu thay đổi'}
                  </button>
                </form>
              </section>

              <section className="app-panel group-invitations-panel">
                <h2>Lời mời đã tạo</h2>
                <p>Thu hồi những lời mời đang chờ và không còn muốn sử dụng.</p>
                {invitationsQuery.isPending ? (
                  <div className="state">Đang tải lời mời…</div>
                ) : invitationsQuery.isError ? (
                  <div className="state state-error" role="alert">
                    <strong>Chưa tải được lời mời</strong>
                    <button type="button" onClick={() => void invitationsQuery.refetch()}>
                      Thử lại
                    </button>
                  </div>
                ) : invitationsQuery.data.length ? (
                  <div className="invitation-list">
                    {invitationsQuery.data.map((invitation) => (
                      <article key={invitation.id}>
                        <span>
                          <strong>{invitation.email}</strong>
                          <small>
                            {invitation.status === 'PENDING'
                              ? 'Đang chờ phản hồi'
                              : invitation.status === 'REVOKED'
                                ? 'Đã thu hồi'
                                : 'Đã xử lý'}
                          </small>
                        </span>
                        {invitation.status === 'PENDING' &&
                          new Date(invitation.expiresAt).getTime() > Date.now() && (
                            <button
                              className="button-danger-quiet invitation-revoke-button"
                              type="button"
                              disabled={revokeMutation.isPending}
                              onClick={() => revokeMutation.mutate(invitation.id)}
                            >
                              Thu hồi
                            </button>
                          )}
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="state">
                    <strong>Chưa có lời mời</strong>
                    <p>Lời mời mới sẽ xuất hiện tại đây.</p>
                  </div>
                )}
                {revokeMutation.isError && (
                  <p className="error" role="alert">
                    {revokeMutation.error.message}
                  </p>
                )}
              </section>
            </div>
          </section>
        )}
      </div>
    </FeaturePage>
  );
}
