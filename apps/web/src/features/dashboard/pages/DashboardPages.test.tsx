// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DashboardPage } from './DashboardPages';

const services = vi.hoisted(() => ({
  getDashboard: vi.fn(), getGroups: vi.fn(), getMeetings: vi.fn(), getNotifications: vi.fn(), getProfile: vi.fn(),
}));
vi.mock('../../../auth/AuthProvider', () => ({ useAuth: () => ({
  status: 'authenticated', user: { username: 'lan', signInDetails: { loginId: 'lan@example.edu' } },
}) }));
vi.mock('../../groups/service', () => ({ getGroups: services.getGroups }));
vi.mock('../../meetings/service', () => ({ getMyMeetings: services.getMeetings }));
vi.mock('../../notifications/service', () => ({ getNotifications: services.getNotifications }));
vi.mock('../../settings/service', () => ({ getProfile: services.getProfile }));
vi.mock('../service', () => ({ getDashboard: services.getDashboard }));

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter><DashboardPage /></MemoryRouter></QueryClientProvider>);
}

describe('DashboardPage', () => {
  afterEach(cleanup);
  beforeEach(() => {
    for (const service of Object.values(services)) service.mockReset();
    services.getDashboard.mockResolvedValue({
      generatedAt: '2026-08-05T10:00:00.000Z',
      tasks: { total: 5, todo: 2, doing: 1, done: 2, overdue: 1 },
    });
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

  it('hiển thị loading riêng cho tổng quan công việc', () => {
    services.getDashboard.mockReturnValue(new Promise(() => undefined));

    renderPage();

    const panel = screen.getByRole('region', { name: 'Tổng quan công việc' });
    expect(within(panel).getByLabelText('Đang tải dữ liệu')).toBeInTheDocument();
    expect(within(panel).queryByText('0')).not.toBeInTheDocument();
  });

  it('hiển thị đủ các số liệu task khi tải thành công', async () => {
    renderPage();

    const panel = screen.getByRole('region', { name: 'Tổng quan công việc' });
    await within(panel).findByText('Tổng');
    expect(within(within(panel).getByText('Tổng').closest('div')!).getByText('5')).toBeInTheDocument();
    expect(within(within(panel).getByText('Chưa làm').closest('div')!).getByText('2')).toBeInTheDocument();
    expect(within(within(panel).getByText('Đang làm').closest('div')!).getByText('1')).toBeInTheDocument();
    expect(within(within(panel).getByText('Hoàn thành').closest('div')!).getByText('2')).toBeInTheDocument();
    expect(within(within(panel).getByText('Quá hạn').closest('div')!).getByText('1')).toBeInTheDocument();
  });

  it('hiển thị zero state chỉ sau khi request thành công', async () => {
    services.getDashboard.mockResolvedValue({
      generatedAt: '2026-08-05T10:00:00.000Z',
      tasks: { total: 0, todo: 0, doing: 0, done: 0, overdue: 0 },
    });

    renderPage();

    expect(await screen.findByText('Bạn chưa có công việc được giao.')).toBeInTheDocument();
  });

  it('cô lập lỗi task summary, không hiển thị số giả và cho phép thử lại', async () => {
    services.getDashboard
      .mockRejectedValueOnce(new Error('dashboard unavailable'))
      .mockResolvedValueOnce({
        generatedAt: '2026-08-05T10:00:01.000Z',
        tasks: { total: 1, todo: 1, doing: 0, done: 0, overdue: 0 },
      });

    renderPage();

    const panel = screen.getByRole('region', { name: 'Tổng quan công việc' });
    expect(await within(panel).findByText('Chưa thể đồng bộ dữ liệu')).toBeInTheDocument();
    expect(within(panel).queryByText('0')).not.toBeInTheDocument();
    expect(await screen.findByText('Đồ án tốt nghiệp')).toBeInTheDocument();
    expect(screen.getByText('Cuộc họp sắp tới')).toBeInTheDocument();

    fireEvent.click(within(panel).getByRole('button', { name: 'Thử lại' }));

    const totalLabel = await within(panel).findByText('Tổng');
    expect(within(totalLabel.closest('div')!).getByText('1')).toBeInTheDocument();
    expect(services.getDashboard).toHaveBeenCalledTimes(2);
  });
});
