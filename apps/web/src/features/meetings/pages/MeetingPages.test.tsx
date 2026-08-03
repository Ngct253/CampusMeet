// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GroupMeetingsPage, MeetingDetailPage } from './MeetingPages';

const services = vi.hoisted(() => ({
  getGroup: vi.fn(),
  getMeetings: vi.fn(),
  createMeeting: vi.fn(),
  getMeeting: vi.fn(),
  updateMeeting: vi.fn(),
  cancelMeeting: vi.fn(),
}));
vi.mock('../../groups/service', () => ({
  getGroup: services.getGroup,
}));
vi.mock('../service', () => ({
  getMeetings: services.getMeetings,
  createMeeting: services.createMeeting,
  getMeeting: services.getMeeting,
  updateMeeting: services.updateMeeting,
  cancelMeeting: services.cancelMeeting,
}));

const authMock = vi.hoisted(() => ({ userId: 'user-1' }));
vi.mock('../../../auth/AuthProvider', () => ({
  useAuth: () => ({ status: 'authenticated', user: { userId: authMock.userId } }),
}));

vi.mock('../../ai', () => ({
  MeetingAIWorkspace: ({ meetingId }: { meetingId: string }) => (
    <div data-testid="meeting-ai-workspace">AI workspace {meetingId}</div>
  ),
}));
afterEach(cleanup);

const meetingFixture = (meetingId = 'meeting-1', organizerId = 'admin') => ({
  id: meetingId,
  groupId: 'group-1',
  title: 'Planning',
  description: 'Agenda overview',
  organizerId,
  attendeeIds: ['admin'],
  agenda: [],
  startsAt: '2030-01-01T10:00:00.000Z',
  endsAt: '2030-01-01T11:00:00.000Z',
  status: 'SCHEDULED',
  googleSyncStatus: 'NOT_REQUESTED',
  integrationStatus: 'NOT_CONNECTED',
  createdAt: '2029-01-01T00:00:00.000Z',
  createdBy: 'admin',
  updatedAt: '2029-01-01T00:00:00.000Z',
  updatedBy: 'admin',
  version: 1,
});

beforeEach(() => {
  vi.clearAllMocks();
  authMock.userId = 'user-1';
  services.getGroup.mockResolvedValue({
    group: { id: 'group-1', name: 'Nhóm A', role: 'MEMBER' },
    members: [],
  });
  services.getMeetings.mockResolvedValue([]);
  services.getMeeting.mockResolvedValue(meetingFixture());
  services.createMeeting.mockResolvedValue({ id: 'meeting-created' });
  services.updateMeeting.mockResolvedValue({});
  services.cancelMeeting.mockResolvedValue({});
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/app/groups/group-1/meetings']}>
        <Routes>
          <Route path={'/app/meetings/:meetingId'} element={<div>Meeting created</div>} />
          <Route path="/app/groups/:groupId/meetings" element={<GroupMeetingsPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function renderDetail() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/app/meetings/meeting-1']}>
        <Routes>
          <Route path={'/app/meetings/:meetingId'} element={<MeetingDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

it('hiển thị loading state trong khi tải timeline', () => {
  services.getMeetings.mockReturnValue(new Promise(() => undefined));
  renderPage();
  expect(screen.getByRole('status')).toBeInTheDocument();
});

it('validate form và submit create thành công', async () => {
  services.getGroup.mockResolvedValue({
    group: { id: 'group-1', name: 'Nhóm A', role: 'GROUP_ADMIN' },
    members: [],
  });
  renderPage();
  const button = await screen.findByRole('button', { name: /tạo cuộc họp/i });
  fireEvent.click(button);
  expect(services.createMeeting).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText(/tiêu đề/i), { target: { value: 'Planning' } });
  fireEvent.click(button);
  await waitFor(() => expect(services.createMeeting).toHaveBeenCalledTimes(1));
});

it('render detail, submit edit và xác nhận cancel', async () => {
  services.getGroup.mockResolvedValue({
    group: { id: 'group-1', name: 'Nhóm A', role: 'GROUP_ADMIN' },
    members: [{ membership: { userId: 'admin' }, user: { displayName: 'Admin' } }],
  });
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
  renderDetail();
  expect(await screen.findByText('Agenda overview')).toBeInTheDocument();
  fireEvent.click(await screen.findByText(/chỉnh sửa cuộc họp/i));
  fireEvent.change(screen.getByLabelText(/tiêu đề/i), { target: { value: 'Updated planning' } });
  fireEvent.click(screen.getByRole('button', { name: /lưu thay đổi/i }));
  await waitFor(() => expect(services.updateMeeting).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole('button', { name: /^hủy cuộc họp$/i }));
  expect(confirm).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(services.cancelMeeting).toHaveBeenCalledTimes(1));
  confirm.mockRestore();
});

it('hiển thị server validation error khi create thất bại', async () => {
  services.getGroup.mockResolvedValue({
    group: { id: 'group-1', name: 'Nhóm A', role: 'GROUP_ADMIN' },
    members: [],
  });
  services.createMeeting.mockRejectedValue(new Error('Tiêu đề không hợp lệ'));
  renderPage();
  fireEvent.change(await screen.findByLabelText(/tiêu đề/i), {
    target: { value: 'Planning' },
  });
  fireEvent.click(screen.getByRole('button', { name: /tạo cuộc họp/i }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Tiêu đề không hợp lệ');
});
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

it('không hiển thị thao tác sinh output cho thành viên không phải organizer', async () => {
  services.getMeeting.mockResolvedValue(meetingFixture('meeting-1', 'admin'));
  renderDetail();

  expect(await screen.findByText('Agenda overview')).toBeInTheDocument();
  expect(screen.queryByTestId('meeting-ai-workspace')).not.toBeInTheDocument();
});

it('cho phép organizer tạo output dù không phải Group Admin', async () => {
  services.getMeeting.mockResolvedValue(meetingFixture('meeting-1', 'user-1'));
  renderDetail();

  expect(await screen.findByTestId('meeting-ai-workspace')).toHaveTextContent('meeting-1');
});
