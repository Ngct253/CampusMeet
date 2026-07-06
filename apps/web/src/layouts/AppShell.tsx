import { NavLink, Outlet } from 'react-router-dom';
import { mockUser } from '../mocks/data';

export function Sidebar() {
  const links = [
    ['/app/dashboard', 'Tổng quan'],
    ['/app/groups', 'Nhóm'],
    ['/app/tasks', 'Công việc'],
    ['/app/notifications', 'Thông báo'],
    ['/app/settings', 'Cài đặt'],
  ] as const;
  return (
    <aside className="sidebar">
      <a className="brand" href="/">
        CampusMeet
      </a>
      <nav aria-label="Điều hướng chính">
        {links.map(([to, label]) => (
          <NavLink key={to} to={to}>
            {label}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}

export function Topbar() {
  return (
    <header className="topbar">
      <span className="mock-banner">Chế độ dữ liệu mô phỏng</span>
      <span>{mockUser.displayName}</span>
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
