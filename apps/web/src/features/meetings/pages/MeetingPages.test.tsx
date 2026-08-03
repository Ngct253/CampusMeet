// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GoogleSyncStatus, MeetingStatus, type Meeting } from '@campusmeet/shared';
import { GroupMeetingsPage, MeetingDetailPage } from './MeetingPages';
import { meetingService } from '../service';

vi.mock('../service', () => ({
  meetingService: {
    list: vi.fn(),
    detail: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    cancel: vi.fn(),
  },
}));

const meeting: Meeting = {
  id: 'm1',
  groupId: 'g1',
  title: 'Sprint planning',
  description: 'Plan work',
  organizerId: 'admin',
  attendeeIds: ['member'],
  agenda: [{ id: 'a1', order: 0, title: 'Goals' }],
  startsAt: '2030-01-01T10:00:00.000Z',
  endsAt: '2030-01-01T11:00:00.000Z',
  status: MeetingStatus.SCHEDULED,
  googleSyncStatus: GoogleSyncStatus.NOT_REQUESTED,
  createdAt: '2029-01-01T00:00:00.000Z',
  createdBy: 'admin',
  updatedAt: '2029-01-01T00:00:00.000Z',
  updatedBy: 'admin',
  version: 1,
};
const response = { success: true as const, requestId: 'request', data: { meeting } };
const renderAt = (path: string) => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/app/groups/:groupId/meetings" element={<GroupMeetingsPage />} />
          <Route path="/app/meetings/:meetingId" element={<MeetingDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

describe('M2 meeting pages', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(cleanup);

  it('hiển thị loading, empty và error states của meeting list', async () => {
    vi.mocked(meetingService.list).mockReturnValueOnce(new Promise(() => undefined));
    const loading = renderAt('/app/groups/g1/meetings');
    expect(screen.getByText('Đang tải lịch họp…')).toBeInTheDocument();
    loading.unmount();

    vi.mocked(meetingService.list).mockResolvedValueOnce({
      success: true,
      requestId: 'r',
      data: { items: [] },
    });
    renderAt('/app/groups/g1/meetings');
    expect(await screen.findByText('Nhóm chưa có cuộc họp.')).toBeInTheDocument();
    cleanup();

    vi.mocked(meetingService.list).mockRejectedValueOnce(new Error('Không thể tải lịch họp'));
    renderAt('/app/groups/g1/meetings');
    expect(await screen.findByRole('alert')).toHaveTextContent('Không thể tải lịch họp');
  });

  it('validate thời gian create form ở frontend', async () => {
    vi.mocked(meetingService.list).mockResolvedValue({
      success: true,
      requestId: 'r',
      data: { items: [] },
    });
    renderAt('/app/groups/g1/meetings');
    fireEvent.click(screen.getByRole('button', { name: 'Tạo cuộc họp' }));
    fireEvent.change(screen.getByLabelText('Bắt đầu'), { target: { value: '2030-01-01T11:00' } });
    fireEvent.change(screen.getByLabelText('Kết thúc'), { target: { value: '2030-01-01T10:00' } });
    expect(screen.getByRole('alert')).toHaveTextContent('Thời gian kết thúc phải sau');
    expect(screen.getByRole('button', { name: 'Tạo cuộc họp' })).toBeDisabled();
  });

  it('submit create thành công', async () => {
    vi.mocked(meetingService.list).mockResolvedValue({
      success: true,
      requestId: 'r',
      data: { items: [] },
    });
    vi.mocked(meetingService.create).mockResolvedValue(response);
    vi.mocked(meetingService.detail).mockResolvedValue({
      ...response,
      data: {
        ...response.data,
        organizer: { userId: 'admin' },
        attendees: [{ userId: 'member' }],
        agenda: meeting.agenda,
      },
    });
    renderAt('/app/groups/g1/meetings');
    fireEvent.click(screen.getByRole('button', { name: 'Tạo cuộc họp' }));
    fireEvent.change(screen.getByLabelText('Tiêu đề'), { target: { value: 'Sprint planning' } });
    fireEvent.change(screen.getByLabelText('Organizer (user ID)'), { target: { value: 'admin' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tạo cuộc họp' }));
    await waitFor(() =>
      expect(meetingService.create).toHaveBeenCalledWith(
        expect.objectContaining({ groupId: 'g1', title: 'Sprint planning', organizerId: 'admin' }),
      ),
    );
  });

  it('hiển thị server validation error khi create', async () => {
    vi.mocked(meetingService.list).mockResolvedValue({
      success: true,
      requestId: 'r',
      data: { items: [] },
    });
    vi.mocked(meetingService.create).mockRejectedValue(new Error('Organizer không còn active'));
    renderAt('/app/groups/g1/meetings');
    fireEvent.click(screen.getByRole('button', { name: 'Tạo cuộc họp' }));
    fireEvent.change(screen.getByLabelText('Tiêu đề'), { target: { value: 'Plan' } });
    fireEvent.change(screen.getByLabelText('Organizer (user ID)'), {
      target: { value: 'inactive' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Tạo cuộc họp' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Organizer không còn active');
  });

  it('render detail và submit edit', async () => {
    vi.mocked(meetingService.detail).mockResolvedValue({
      ...response,
      data: {
        ...response.data,
        organizer: { userId: 'admin' },
        attendees: [{ userId: 'member' }],
        agenda: meeting.agenda,
      },
    });
    vi.mocked(meetingService.update).mockResolvedValue({
      ...response,
      data: { meeting: { ...meeting, title: 'Updated', version: 2 } },
    });
    renderAt('/app/meetings/m1');
    expect(await screen.findByRole('heading', { name: 'Sprint planning' })).toBeInTheDocument();
    expect(screen.getByText('Goals')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sửa' }));
    fireEvent.change(screen.getByLabelText('Tiêu đề'), { target: { value: 'Updated' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
    await waitFor(() =>
      expect(meetingService.update).toHaveBeenCalledWith(
        'm1',
        expect.objectContaining({ title: 'Updated', version: 1 }),
      ),
    );
  });

  it('confirm trước cancel và chỉ gửi request khi đồng ý', async () => {
    vi.mocked(meetingService.detail).mockResolvedValue({
      ...response,
      data: {
        ...response.data,
        organizer: { userId: 'admin' },
        attendees: [{ userId: 'member' }],
        agenda: meeting.agenda,
      },
    });
    vi.mocked(meetingService.cancel).mockResolvedValue(response);
    const confirm = vi
      .spyOn(window, 'confirm')
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    renderAt('/app/meetings/m1');
    const button = await screen.findByRole('button', { name: 'Hủy cuộc họp' });
    fireEvent.click(button);
    expect(meetingService.cancel).not.toHaveBeenCalled();
    fireEvent.click(button);
    await waitFor(() => expect(meetingService.cancel).toHaveBeenCalledWith('m1', { version: 1 }));
    confirm.mockRestore();
  });
});
