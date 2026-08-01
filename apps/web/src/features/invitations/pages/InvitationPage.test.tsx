// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import { InvitationInboxPage } from './InvitationPage';

const invitation = {
  id: 'invite-1',
  groupId: 'group-1',
  groupName: 'Nhóm A',
  email: 'lan@example.edu',
  status: 'PENDING' as const,
  createdAt: '2026-08-01T00:00:00.000Z',
  expiresAt: '2099-08-08T00:00:00.000Z',
};
const getMyInvitations = vi.hoisted(() => vi.fn());
const respondDirectInvitation = vi.hoisted(() => vi.fn());
vi.mock('../service', () => ({ getMyInvitations, respondDirectInvitation }));

beforeEach(() => {
  getMyInvitations.mockReset();
  respondDirectInvitation.mockReset();
});

it('cho phép chấp nhận lời mời trực tiếp trong ứng dụng', async () => {
  getMyInvitations.mockResolvedValue([invitation]);
  respondDirectInvitation.mockResolvedValue({ ...invitation, status: 'ACCEPTED' });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/app/invitations']}>
        <Routes>
          <Route path="/app/invitations" element={<InvitationInboxPage />} />
          <Route path="/app/groups/:groupId" element={<p>Đã vào nhóm</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

  fireEvent.click(await screen.findByRole('button', { name: 'Chấp nhận' }));

  expect(await screen.findByText('Đã vào nhóm')).toBeInTheDocument();
  expect(respondDirectInvitation).toHaveBeenCalledWith('invite-1', 'accept');
});

it('không dùng lời mời mới thay cho notification của lời mời cũ', async () => {
  getMyInvitations.mockResolvedValue([{ ...invitation, id: 'invite-new' }]);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/app/invitations?invitationId=invite-old']}>
        <Routes>
          <Route path="/app/invitations" element={<InvitationInboxPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

  expect(await screen.findByText('Lời mời không còn chờ phản hồi')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Chấp nhận' })).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Xem lời mời đang chờ' })).toHaveClass('button');
  expect(respondDirectInvitation).not.toHaveBeenCalled();
});
