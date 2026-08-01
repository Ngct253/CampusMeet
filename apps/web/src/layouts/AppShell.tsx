import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import './AppShell.css';

function NavIcon({
  name,
}: {
  name: 'dashboard' | 'groups' | 'invitations' | 'tasks' | 'notifications' | 'settings';
}) {
  const paths = {
    dashboard: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="2" />
        <rect x="14" y="3" width="7" height="7" rx="2" />
        <rect x="3" y="14" width="7" height="7" rx="2" />
        <rect x="14" y="14" width="7" height="7" rx="2" />
      </>
    ),
    groups: (
      <>
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
      </>
    ),
    invitations: (
      <>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="m3 7 9 6 9-6" />
      </>
    ),
    tasks: (
      <>
        <path d="M9 11l3 3L22 4" />
        <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
      </>
    ),
    notifications: (
      <>
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      </>
    ),
    settings: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06-2.83 2.83-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21h-4v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06-2.83-2.83.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3v-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06L7.04 4.3l.06.06A1.65 1.65 0 0 0 8.92 4a1.65 1.65 0 0 0 1-1.51V2h4v.09A1.65 1.65 0 0 0 15 3.6a1.65 1.65 0 0 0 1.82-.33l.06-.06 2.83 2.83-.06.06A1.65 1.65 0 0 0 19.4 8c.12.61.65 1.06 1.27 1.08H21v4h-.09A1.65 1.65 0 0 0 19.4 15Z" />
      </>
    ),
  };
  return (
    <svg className="nav-icon" viewBox="0 0 24 24" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

export function Sidebar() {
  const links = [
    ['/app/dashboard', 'Tổng quan', 'dashboard'],
    ['/app/groups', 'Nhóm', 'groups'],
    ['/app/invitations', 'Lời mời', 'invitations'],
    ['/app/tasks', 'Công việc', 'tasks'],
    ['/app/notifications', 'Thông báo', 'notifications'],
    ['/app/settings', 'Cài đặt', 'settings'],
  ] as const;
  return (
    <aside className="sidebar">
      <a className="brand" href="/" aria-label="CampusMeet - Trang chủ">
        <span className="brand-mark" aria-hidden="true">
          C
        </span>
        <span>CampusMeet</span>
      </a>
      <p className="sidebar-label">Không gian làm việc</p>
      <nav aria-label="Điều hướng chính">
        {links.map(([to, label, icon]) => (
          <NavLink key={to} to={to}>
            <NavIcon name={icon} />
            {label}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}

export function Topbar() {
  const auth = useAuth();
  const identity =
    auth.status === 'authenticated' ? (auth.user.signInDetails?.loginId ?? auth.user.username) : '';
  const initial = identity.charAt(0).toUpperCase() || 'C';
  return (
    <header className="topbar">
      <div className="topbar-context">
        <strong>Không gian cá nhân</strong>
        <span>Quản lý cuộc họp hiệu quả hơn mỗi ngày</span>
      </div>
      <div className="topbar-user">
        <span className="user-avatar" aria-hidden="true">
          {initial}
        </span>
        <span className="user-identity">{identity}</span>
        <button type={'button'} onClick={() => void auth.signOut()}>
          Đăng xuất
        </button>
      </div>
    </header>
  );
}

export function AppShell() {
  return (
    <div className="app-shell">
      <Sidebar />
      <div className="app-main">
        <Topbar />
        <main>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
