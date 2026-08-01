// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import { NotificationsPage } from './NotificationsPage';

const getNotifications = vi.hoisted(() => vi.fn());
const markNotificationRead = vi.hoisted(() => vi.fn());
vi.mock('../service', () => ({ getNotifications, markNotificationRead }));

const unread = {
  id: 'invitation-invite-1',
  userId: 'user-1',
  type: 'INVITATION' as const,
  title: 'Bạn được mời tham gia nhóm A',
  read: false,
  createdAt: '2026-08-01T12:00:00.000Z',
  actionUrl: '/app/invitations?invitationId=invite-1',
};
const read = { ...unread, id: 'old', title: 'Thông báo đã xem', read: true };

it('đánh dấu đã đọc khi mở đúng lời mời từ thông báo', async () => {
  getNotifications
    .mockResolvedValueOnce([unread, read])
    .mockResolvedValue([{ ...unread, read: true }, read]);
  markNotificationRead.mockResolvedValue(undefined);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Routes>
          <Route path="/" element={<NotificationsPage />} />
          <Route path="/app/invitations" element={<p>Đúng lời mời</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

  expect(await screen.findByText(unread.title)).toBeInTheDocument();
  expect(screen.queryByText(read.title)).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Đã đọc' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('link', { name: /Bạn được mời tham gia nhóm A/i }));

  expect(await screen.findByText('Đúng lời mời')).toBeInTheDocument();
  expect(markNotificationRead.mock.calls[0]?.[0]).toBe(unread.id);
});
