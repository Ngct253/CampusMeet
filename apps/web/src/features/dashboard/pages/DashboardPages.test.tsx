// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DashboardPage } from './DashboardPages';

const services = vi.hoisted(() => ({
  getGroups: vi.fn(), getMeetings: vi.fn(), getNotifications: vi.fn(), getProfile: vi.fn(),
}));
vi.mock('../../../auth/AuthProvider', () => ({ useAuth: () => ({
  status: 'authenticated', user: { username: 'lan', signInDetails: { loginId: 'lan@example.edu' } },
}) }));
vi.mock('../../groups/service', () => ({ getGroups: services.getGroups }));
vi.mock('../../meetings/service', () => ({ getMyMeetings: services.getMeetings }));
vi.mock('../../notifications/service', () => ({ getNotifications: services.getNotifications }));
vi.mock('../../settings/service', () => ({ getProfile: services.getProfile }));

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter><DashboardPage /></MemoryRouter></QueryClientProvider>);
}

describe('DashboardPage', () => {
  afterEach(cleanup);
  beforeEach(() => {
    services.getGroups.mockResolvedValue([{ id: 'group-1', name: 'Đồ án tốt nghiệp', createdBy: 'user-1', createdAt: '2026-08-01T00:00:00.000Z', role: 'GROUP_ADMIN', joinedAt: '2026-08-01T00:00:00.000Z' }]);
    services.getMeetings.mockResolvedValue([]);
    services.getNotifications.mockResolvedValue([{ id: 'notification-1', userId: 'user-1', type: 'INVITATION', title: 'Bạn có lời mời mới', read: false, createdAt: '2026-08-01T00:00:00.000Z' }]);
    services.getProfile.mockResolvedValue({ id: 'user-1', email: 'lan@example.edu', displayName: 'Lan', timezone: 'Asia/Ho_Chi_Minh', emailNotificationsEnabled: true });
  });

  it('hiện dữ liệu thật và đầy đủ khung tổng quan', async () => {
    renderPage();
    expect(await screen.findByText('Đồ án tốt nghiệp')).toBeInTheDocument();
    expect(screen.getByText('Cuộc họp sắp tới')).toBeInTheDocument();
    expect(screen.getByText('Bạn có lời mời mới')).toBeInTheDocument();
    expect(screen.queryByText(/mô phỏng|TODO/i)).not.toBeInTheDocument();
  });

  it('giữ nguyên khung khi một nguồn dữ liệu mất kết nối', async () => {
    services.getGroups.mockRejectedValue(new TypeError('Failed to fetch'));
    renderPage();
    expect(await screen.findByText('Chưa thể đồng bộ dữ liệu')).toBeInTheDocument();
    expect(screen.getByText('Cuộc họp sắp tới')).toBeInTheDocument();
    expect(screen.getByText('Cần chú ý')).toBeInTheDocument();
    expect(screen.queryByText('Failed to fetch')).not.toBeInTheDocument();
    expect(screen.queryByText('Bạn chưa có nhóm nào')).not.toBeInTheDocument();
  });
});
