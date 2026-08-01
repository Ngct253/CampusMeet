// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RequireAuth } from './RequireAuth';

const mockUseAuth = vi.hoisted(() => vi.fn());
vi.mock('./AuthProvider', () => ({ useAuth: mockUseAuth }));

function renderGuard(path: string, status: string) {
  mockUseAuth.mockReturnValue(status === 'authenticated'
    ? { status, user: { username: 'lan' }, signOut: vi.fn() }
    : { status, user: null, error: status === 'configuration-error' ? 'unavailable' : null });
  render(<MemoryRouter initialEntries={[path]}><Routes>
    <Route path={'*'} element={<RequireAuth />} />
    <Route path={'/sign-in'} element={<p>Trang đăng nhập</p>} />
  </Routes></MemoryRouter>);
}

describe('RequireAuth', () => {
  beforeEach(() => {
    cleanup();
    sessionStorage.clear();
  });

  for (const status of ['unauthenticated', 'configuration-error']) {
    for (const path of ['/app', '/app/dashboard']) {
      it(`${status} mở ${path} được chuyển tới /sign-in`, () => {
        renderGuard(path, status);
        expect(screen.getByText('Trang đăng nhập')).toBeInTheDocument();
        expect(sessionStorage.getItem('campusmeet:returnTo')).toBe(path);
      });
    }
  }

  it('authenticated vẫn render AppShell', () => {
    renderGuard('/app/dashboard', 'authenticated');
    expect(screen.getByText('Không gian cá nhân')).toBeInTheDocument();
  });

  it('từ chối URL quay lại ngoài /app', () => {
    sessionStorage.setItem('campusmeet:returnTo', '/app/tasks');
    renderGuard('/outside', 'unauthenticated');
    expect(sessionStorage.getItem('campusmeet:returnTo')).toBeNull();
  });
});
