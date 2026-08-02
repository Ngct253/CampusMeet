// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GroupMeetingsPage } from './MeetingPages';

const services = vi.hoisted(() => ({ getGroup: vi.fn(), getMeetings: vi.fn() }));
vi.mock('../../groups/service', () => ({
  getGroup: services.getGroup,
}));
vi.mock('../service', () => ({
  getMeetings: services.getMeetings,
  createMeeting: vi.fn(),
  getMeeting: vi.fn(),
  updateMeeting: vi.fn(),
  cancelMeeting: vi.fn(),
}));

afterEach(cleanup);

beforeEach(() => {
  services.getGroup.mockResolvedValue({
    group: { id: 'group-1', name: 'Nhóm A', role: 'MEMBER' },
    members: [],
  });
  services.getMeetings.mockResolvedValue([]);
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/app/groups/group-1/meetings']}>
        <Routes>
          <Route path="/app/groups/:groupId/meetings" element={<GroupMeetingsPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

it('hiển thị trạng thái rỗng rõ ràng và ẩn biểu mẫu tạo với thành viên thường', async () => {
  renderPage();
  expect(await screen.findByText('Chưa có cuộc họp sắp tới')).toBeInTheDocument();
  expect(screen.getByText('Quản trị viên nhóm chưa tạo lịch mới.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Tạo cuộc họp' })).not.toBeInTheDocument();
});

it('giải thích đúng khi máy chủ AWS chưa có API cuộc họp', async () => {
  services.getMeetings.mockRejectedValue(new Error('API CampusMeet trả lỗi 404.'));
  renderPage();
  expect(await screen.findByText('Máy chủ chưa có chức năng cuộc họp')).toBeInTheDocument();
  expect(
    screen.getByText('Cần triển khai phiên bản CampusMeet mới lên AWS trước khi sử dụng.'),
  ).toBeInTheDocument();
  expect(screen.queryByText('0 cuộc họp')).not.toBeInTheDocument();
});

it('dùng giờ 24 tiếng không phụ thuộc CH hoặc SA', async () => {
  services.getGroup.mockResolvedValue({
    group: { id: 'group-1', name: 'Nhóm A', role: 'GROUP_ADMIN' },
    members: [
      {
        membership: { userId: 'user-1' },
        user: { displayName: 'Lan', email: 'lan@example.edu' },
      },
    ],
  });
  renderPage();
  const start = (await screen.findByLabelText('Bắt đầu')) as HTMLSelectElement;
  const end = screen.getByLabelText('Kết thúc') as HTMLSelectElement;
  expect(start.value).toMatch(/^\d{2}:(?:00|15|30|45)$/);
  expect(end.value).toMatch(/^\d{2}:(?:00|15|30|45)$/);
  expect(screen.getAllByRole('option', { name: '13:30' })).toHaveLength(2);
  expect(screen.getByText('Lan')).toBeInTheDocument();
  expect(screen.getByText('lan@example.edu')).toBeInTheDocument();
  expect(screen.queryByText(/\b(?:CH|SA)\b/)).not.toBeInTheDocument();
});
