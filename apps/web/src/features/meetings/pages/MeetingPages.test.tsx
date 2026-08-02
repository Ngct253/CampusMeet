// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import { GroupMeetingsPage } from './MeetingPages';

vi.mock('../../groups/service', () => ({
  getGroup: vi.fn().mockResolvedValue({
    group: { id: 'group-1', name: 'Nhóm A', role: 'MEMBER' },
    members: [],
  }),
}));
vi.mock('../service', () => ({
  getMeetings: vi.fn().mockResolvedValue([]),
  createMeeting: vi.fn(),
  getMeeting: vi.fn(),
  updateMeeting: vi.fn(),
  cancelMeeting: vi.fn(),
}));

it('hiển thị trạng thái rỗng rõ ràng và ẩn biểu mẫu tạo với thành viên thường', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/app/groups/group-1/meetings']}>
        <Routes>
          <Route path="/app/groups/:groupId/meetings" element={<GroupMeetingsPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(await screen.findByText('Chưa có cuộc họp sắp tới')).toBeInTheDocument();
  expect(screen.getByText('Quản trị viên nhóm chưa tạo lịch mới.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Tạo cuộc họp' })).not.toBeInTheDocument();
});
