import { Navigate, useLocation } from 'react-router-dom';
import { AppShell } from '../layouts/AppShell';
import { useAuth } from './AuthProvider';

export function RequireAuth() {
  const auth = useAuth();
  const location = useLocation();
  if (auth.status === 'loading') return <main className="auth-status">Đang kiểm tra phiên đăng nhập...</main>;
  if (auth.status === 'unauthenticated' || auth.status === 'configuration-error') {
    const path = location.pathname + location.search + location.hash;
    if (location.pathname === '/app' || location.pathname.startsWith('/app/'))
      sessionStorage.setItem('campusmeet:returnTo', path);
    else sessionStorage.removeItem('campusmeet:returnTo');
    return <Navigate to="/sign-in" replace />;
  }
  return <AppShell />;
}
