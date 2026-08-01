// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import { GroupsPage } from './GroupPages';

const getGroups = vi.hoisted(() => vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
vi.mock('../service', () => ({
  getGroups,
  createGroup: vi.fn(),
  getGroup: vi.fn(),
  getGroupInvitations: vi.fn(),
  inviteMember: vi.fn(),
  removeMember: vi.fn(),
  revokeInvitation: vi.fn(),
  updateGroup: vi.fn(),
}));

it('không gọi lỗi kết nối là danh sách nhóm rỗng', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter><GroupsPage /></MemoryRouter></QueryClientProvider>);
  expect(await screen.findByText('Danh sách nhóm chưa được đồng bộ')).toBeInTheDocument();
  expect(screen.queryByText('Failed to fetch')).not.toBeInTheDocument();
  expect(screen.queryByText('Bạn chưa có nhóm nào')).not.toBeInTheDocument();
});
