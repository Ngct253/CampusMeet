// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError } from '../../../lib/api-client';
import { GroupMeetingsPage, MeetingDetailPage } from './MeetingPages';

const services = vi.hoisted(() => ({
  getGroup: vi.fn(),
  getMeetings: vi.fn(),
  createMeeting: vi.fn(),
  getMeeting: vi.fn(),
  updateMeeting: vi.fn(),
  cancelMeeting: vi.fn(),
  getMeetingMinutes: vi.fn(),
  updateMeetingMinutes: vi.fn(),
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
  getMeetingMinutes: services.getMeetingMinutes,
  updateMeetingMinutes: services.updateMeetingMinutes,
}));

const authMock = vi.hoisted(() => ({ userId: 'user-1' }));

vi.mock('../../../auth/AuthProvider', () => ({
  useAuth: () => ({
    status: 'authenticated',
    user: { userId: authMock.userId },
  }),
}));

vi.mock('../../ai', () => ({
  MeetingAIWorkspace: ({ meetingId }: { meetingId: string }) => (
    <div data-testid="meeting-ai-workspace">AI workspace {meetingId}</div>
  ),
}));

afterEach(cleanup);

const meetingFixture = (
  meetingId = 'meeting-1',
  organizerId = 'admin-1',
  status = 'COMPLETED',
) => ({
  id: meetingId,
  groupId: 'group-1',
  title: 'Họp tuần',
  description: 'Agenda overview',
  organizerId,
  attendeeIds: ['admin-1', 'user-1'],
  agenda: [],
  startsAt: '2026-08-04T01:00:00.000Z',
  endsAt: '2026-08-04T02:00:00.000Z',
  status,
  googleSyncStatus: 'NOT_REQUESTED',
  integrationStatus: 'READY',
  createdAt: '2026-08-01T00:00:00.000Z',
  createdBy: organizerId,
  updatedAt: '2026-08-01T00:00:00.000Z',
  updatedBy: organizerId,
  version: 1,
});

const meeting = meetingFixture();

const minutes = {
  id: 'minutes-1',
  meetingId: 'meeting-1',
  groupId: 'group-1',
  summary: 'Tóm tắt đã lưu',
  discussion: 'Nội dung đã lưu',
  decisions: [{ id: 'decision-1', content: 'Quyết định A' }],
  actionItems: [{ id: 'action-1', content: 'Việc A', assigneeId: 'user-1' }],
  version: 2,
  createdBy: 'admin-1',
  createdAt: '2026-08-04T03:00:00.000Z',
};

const groupDetails = (role: 'MEMBER' | 'GROUP_ADMIN') => ({
  group: { id: 'group-1', name: 'Nhóm A', role },
  members: [
    {
      membership: { userId: 'admin-1', role: 'GROUP_ADMIN', active: true },
      user: { displayName: 'An', email: 'an@example.edu' },
    },
    {
      membership: { userId: 'user-1', role: 'MEMBER', active: true },
      user: { displayName: 'Lan', email: 'lan@example.edu' },
    },
  ],
});

beforeEach(() => {
  vi.clearAllMocks();
  authMock.userId = 'user-1';

  services.getGroup.mockResolvedValue({
    group: { id: 'group-1', name: 'Nhóm A', role: 'MEMBER' },
    members: [],
  });

  services.getMeetings.mockResolvedValue([]);
  services.getMeeting.mockResolvedValue(meeting);
  services.createMeeting.mockResolvedValue({ id: 'meeting-created' });
  services.updateMeeting.mockResolvedValue({});
  services.cancelMeeting.mockResolvedValue({});
  services.getMeetingMinutes.mockRejectedValue(
    new ApiClientError('Chưa có biên bản.', 404, 'NOT_FOUND'),
  );
  services.updateMeetingMinutes.mockReset();
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/app/groups/group-1/meetings']}>
        <Routes>
          <Route path="/app/meetings/:meetingId" element={<div>Meeting created</div>} />
          <Route path="/app/groups/:groupId/meetings" element={<GroupMeetingsPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function renderDetail(role: 'MEMBER' | 'GROUP_ADMIN' = 'GROUP_ADMIN') {
  services.getGroup.mockResolvedValue(groupDetails(role));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(client, 'invalidateQueries');

  return {
    client,
    invalidate,
    ...render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/app/meetings/meeting-1']}>
          <Routes>
            <Route path="/app/meetings/:meetingId" element={<MeetingDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  };
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
  services.getMeeting.mockResolvedValue(meetingFixture('meeting-1', 'admin', 'SCHEDULED'));
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
  renderDetail();

  expect(await screen.findByText('Agenda overview')).toBeInTheDocument();
  fireEvent.click(await screen.findByText(/chỉnh sửa cuộc họp/i));
  fireEvent.change(screen.getByLabelText(/tiêu đề/i), {
    target: { value: 'Updated planning' },
  });
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
  renderDetail('MEMBER');

  expect(await screen.findByText('Agenda overview')).toBeInTheDocument();
  expect(screen.queryByTestId('meeting-ai-workspace')).not.toBeInTheDocument();
});

it('cho phép organizer tạo output dù không phải Group Admin', async () => {
  services.getMeeting.mockResolvedValue(meetingFixture('meeting-1', 'user-1'));
  renderDetail('MEMBER');

  expect(await screen.findByTestId('meeting-ai-workspace')).toHaveTextContent('meeting-1');
});

describe('Meeting Minutes on MeetingDetailPage', () => {
  it('shows loading, non-404 error, and retry states', async () => {
    let rejectMinutes!: (error: Error) => void;
    services.getMeetingMinutes.mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectMinutes = reject;
      }),
    );
    renderDetail('MEMBER');
    expect(await screen.findByText('Đang tải biên bản…')).toBeInTheDocument();
    rejectMinutes(new ApiClientError('DynamoDB unavailable', 500, 'INTERNAL_ERROR'));
    expect(await screen.findByText('Chưa thể tải biên bản')).toBeInTheDocument();
    expect(screen.getByText('DynamoDB unavailable')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Thử lại' })).toBeInTheDocument();
  });

  it('shows saved Minutes read-only to a regular member', async () => {
    services.getMeetingMinutes.mockResolvedValue(minutes);
    renderDetail('MEMBER');
    expect(await screen.findByText('Tóm tắt đã lưu')).toBeInTheDocument();
    expect(screen.getByText('Quyết định A')).toBeInTheDocument();
    expect(screen.getByText(/Việc A — Lan/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Lưu biên bản' })).not.toBeInTheDocument();
  });

  it('shows no editor to a regular member when Minutes do not exist', async () => {
    renderDetail('MEMBER');
    expect(await screen.findByText('Chưa có biên bản')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Lưu biên bản' })).not.toBeInTheDocument();
  });

  it('shows the empty state and saves the first version with expectedVersion zero', async () => {
    services.updateMeetingMinutes.mockImplementation(
      async (_meetingId: string, input: Record<string, unknown>) => ({
        ...minutes,
        summary: input.summary,
        discussion: input.discussion,
        decisions: input.decisions,
        actionItems: input.actionItems,
        version: 1,
      }),
    );
    const { invalidate } = renderDetail();
    expect(await screen.findByText('Chưa có biên bản')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Tóm tắt'), {
      target: { value: 'Biên bản đầu' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Thêm quyết định' }));
    fireEvent.change(screen.getByLabelText('Quyết định 1'), {
      target: { value: 'Chốt phương án' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Thêm việc cần thực hiện' }));
    fireEvent.change(screen.getByLabelText('Việc cần thực hiện 1'), {
      target: { value: 'Viết báo cáo' },
    });
    fireEvent.change(screen.getByLabelText('Người phụ trách 1'), {
      target: { value: 'user-1' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu biên bản' }));
    await waitFor(() => expect(services.updateMeetingMinutes).toHaveBeenCalledTimes(1));
    expect(services.updateMeetingMinutes).toHaveBeenCalledWith(
      'meeting-1',
      expect.objectContaining({ expectedVersion: 0, summary: 'Biên bản đầu' }),
    );
    expect(await screen.findByText('Đã lưu phiên bản 1.')).toBeInTheDocument();
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['meetings', 'meeting-1', 'minutes'],
    });
  });

  it('edits version N, adds/removes rows, and uses only active group member options', async () => {
    services.getMeetingMinutes.mockResolvedValue(minutes);
    renderDetail();
    expect(await screen.findByDisplayValue('Tóm tắt đã lưu')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'An' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Lan' })).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Xóa' })[0]!);
    expect(screen.queryByLabelText('Quyết định 1')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Xóa' }));
    expect(screen.queryByLabelText('Việc cần thực hiện 1')).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Người ngoài nhóm' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Tóm tắt'), { target: { value: 'Bản sửa' } });
    services.updateMeetingMinutes.mockResolvedValue({ ...minutes, summary: 'Bản sửa', version: 3 });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu biên bản' }));
    await waitFor(() =>
      expect(services.updateMeetingMinutes).toHaveBeenCalledWith(
        'meeting-1',
        expect.objectContaining({ expectedVersion: 2 }),
      ),
    );
  });

  it('locks double submit while pending', async () => {
    let resolveSave!: (value: typeof minutes) => void;
    services.updateMeetingMinutes.mockReturnValue(
      new Promise((resolve) => {
        resolveSave = resolve;
      }),
    );
    renderDetail();
    await screen.findByText('Chưa có biên bản');
    fireEvent.change(screen.getByLabelText('Tóm tắt'), { target: { value: 'Draft' } });
    const save = screen.getByRole('button', { name: 'Lưu biên bản' });
    fireEvent.click(save);
    fireEvent.click(save);
    await waitFor(() => expect(services.updateMeetingMinutes).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', { name: 'Đang lưu…' })).toBeDisabled();
    resolveSave({ ...minutes, summary: 'Draft', version: 1 });
    expect(await screen.findByText('Đã lưu phiên bản 1.')).toBeInTheDocument();
  });

  it('keeps the entire draft and refetches on 409', async () => {
    services.getMeetingMinutes.mockResolvedValue(minutes);
    services.updateMeetingMinutes.mockRejectedValue(
      new ApiClientError('Conflict', 409, 'CONFLICT'),
    );
    const { invalidate } = renderDetail();
    const summary = (await screen.findByLabelText('Tóm tắt')) as HTMLTextAreaElement;
    fireEvent.change(summary, { target: { value: 'Bản nháp chưa lưu' } });
    fireEvent.click(screen.getByRole('button', { name: 'Thêm quyết định' }));
    fireEvent.change(screen.getByLabelText('Quyết định 2'), {
      target: { value: 'Quyết định nháp' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu biên bản' }));
    expect(await screen.findByText(/Bản nháp của bạn vẫn được giữ/)).toBeInTheDocument();
    expect(screen.getByDisplayValue('Bản nháp chưa lưu')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Quyết định nháp')).toBeInTheDocument();
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['meetings', 'meeting-1', 'minutes'],
    });
  });

  it('keeps a version-zero draft when a 409 refetch discovers version one', async () => {
    services.getMeetingMinutes
      .mockRejectedValueOnce(new ApiClientError('Chưa có biên bản.', 404, 'NOT_FOUND'))
      .mockResolvedValue(minutes);
    services.updateMeetingMinutes.mockRejectedValue(
      new ApiClientError('Conflict', 409, 'CONFLICT'),
    );
    renderDetail();
    await screen.findByText('Chưa có biên bản');
    fireEvent.change(screen.getByLabelText('Tóm tắt'), {
      target: { value: 'Draft version zero' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu biên bản' }));
    expect(await screen.findByText(/Bản nháp của bạn vẫn được giữ/)).toBeInTheDocument();
    expect(screen.getByDisplayValue('Draft version zero')).toBeInTheDocument();
    await waitFor(() => expect(services.getMeetingMinutes).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('button', { name: 'Dùng phiên bản mới làm mốc' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Tóm tắt'), {
      target: { value: 'Draft vẫn tiếp tục được sửa' },
    });
    expect(screen.getByDisplayValue('Draft vẫn tiếp tục được sửa')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dùng phiên bản mới làm mốc' })).toBeInTheDocument();
  });

  it('shows cancelled Minutes read-only without a save editor', async () => {
    services.getMeeting.mockResolvedValue(meetingFixture('meeting-1', 'admin-1', 'CANCELLED'));
    services.getMeetingMinutes.mockResolvedValue(minutes);
    renderDetail();
    expect(
      await screen.findByText('Không thể chỉnh sửa biên bản của cuộc họp đã hủy.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Lưu biên bản' })).not.toBeInTheDocument();
  });

  it.each([
    [403, 'FORBIDDEN', 'Bạn không có quyền ghi biên bản này.'],
    [422, 'UNPROCESSABLE_ENTITY', 'Không thể cập nhật biên bản của cuộc họp đã hủy.'],
  ])('shows mutation error %s without losing the draft', async (status, code, expected) => {
    services.updateMeetingMinutes.mockRejectedValue(new ApiClientError(expected, status, code));
    renderDetail();
    await screen.findByText('Chưa có biên bản');
    fireEvent.change(screen.getByLabelText('Tóm tắt'), {
      target: { value: 'Draft còn nguyên' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu biên bản' }));
    expect(await screen.findByText(expected)).toBeInTheDocument();
    expect(screen.getByDisplayValue('Draft còn nguyên')).toBeInTheDocument();
  });
});
