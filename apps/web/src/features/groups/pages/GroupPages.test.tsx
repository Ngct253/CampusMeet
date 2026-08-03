// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { GroupDetailPage, GroupsPage } from './GroupPages';

const groupServices = vi.hoisted(() => ({
  getGroups: vi.fn().mockRejectedValue(new TypeError('Failed to fetch')),
  getGroup: vi.fn(),
  getGroupInvitations: vi.fn().mockResolvedValue([]),
  inviteMember: vi.fn(),
  removeMember: vi.fn(),
  revokeInvitation: vi.fn(),
  updateGroup: vi.fn(),
  createGroup: vi.fn(),
}));
vi.mock('../service', () => groupServices);

afterEach(cleanup);


const meetingServices = vi.hoisted(() => ({ getMeetings: vi.fn().mockResolvedValue([]) }));
vi.mock('../../meetings/service', () => meetingServices);

vi.mock('../../../auth/AuthProvider', () => ({
  useAuth: () => ({ status: 'authenticated', user: { userId: 'user-1' } }),
}));

vi.mock('../../ai', () => ({
  GroupSearchPanel: ({ onSearch: _s }: { onSearch: unknown }) => (
    <div data-testid="group-search-panel">Tìm trong tài liệu của nhóm</div>
  ),
  ProgressAnalysisPanel: ({ isGroupAdmin }: { isGroupAdmin: boolean }) =>
    isGroupAdmin ? <div data-testid="progress-panel">Tiến độ nhóm</div> : null,
  AIJobState: () => null,
  createAIIdempotencyKey: () => 'key-test',
  useAIJob: () => ({ data: undefined, isLoading: false, isError: false }),
  useGroupSearchMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useProgressAnalysisMutation: () => ({ mutate: vi.fn(), isPending: false }),
}));

const groupDetailFixture = (role: 'MEMBER' | 'GROUP_ADMIN') => ({
  group: { id: 'group-1', name: 'Nhóm Test', role, description: 'Mô tả' },
  members: [
    {
      membership: { id: 'mem-1', userId: 'user-1', groupId: 'group-1', role, createdAt: '' },
      user: { userId: 'user-1', displayName: 'Lan', email: 'lan@test.edu' },
    },
  ],
});

function renderGroupDetail(role: 'MEMBER' | 'GROUP_ADMIN' = 'MEMBER') {
  groupServices.getGroup.mockResolvedValue(groupDetailFixture(role));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/app/groups/group-1']}>
        <Routes>
          <Route path="/app/groups/:groupId" element={<GroupDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

it('không gọi lỗi kết nối là danh sách nhóm rỗng', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <GroupsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(await screen.findByText('Danh sách nhóm chưa được đồng bộ')).toBeInTheDocument();
  expect(screen.queryByText('Failed to fetch')).not.toBeInTheDocument();
  expect(screen.queryByText('Bạn chưa có nhóm nào')).not.toBeInTheDocument();
});

it('GroupSearchPanel hiển thị với thành viên thường', async () => {
  renderGroupDetail('MEMBER');
  expect(await screen.findByTestId('group-search-panel')).toBeInTheDocument();
});

it('GroupSearchPanel hiển thị với admin', async () => {
  renderGroupDetail('GROUP_ADMIN');
  expect(await screen.findByTestId('group-search-panel')).toBeInTheDocument();
});

it('ProgressAnalysisPanel và nút Chạy phân tích ẩn với thành viên thường', async () => {
  renderGroupDetail('MEMBER');
  await screen.findByTestId('group-search-panel');
  expect(screen.queryByTestId('progress-panel')).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Chạy phân tích tiến độ' }),
  ).not.toBeInTheDocument();
});

it('ProgressAnalysisPanel hiển thị với admin', async () => {
  renderGroupDetail('GROUP_ADMIN');
  expect(await screen.findByTestId('progress-panel')).toBeInTheDocument();
});
