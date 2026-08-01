// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { AppShell } from './AppShell';

vi.mock('../auth/AuthProvider', () => ({ useAuth: () => ({
  status: 'authenticated', user: { username: 'lan', userId: 'user-1' },
  signOut: vi.fn(), error: null,
}) }));

describe('AppShell', () => {
  it('renders authenticated navigation without a simulation banner', () => {
    render(
      <MemoryRouter initialEntries={['/app']}>
        <Routes>
          <Route path="/app" element={<AppShell />}>
            <Route index element={<p>Nội dung</p>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText('Không gian cá nhân')).toBeInTheDocument();
    expect(screen.queryByText(/mô phỏng/i)).not.toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Điều hướng chính' })).toBeInTheDocument();
  });
});
