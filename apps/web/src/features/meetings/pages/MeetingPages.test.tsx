// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError } from '../../../lib/api-client';
import { GroupMeetingsPage, MeetingDetailPage } from './MeetingPages';

vi.mock('../../../config/environment', () => ({
  environment: { capabilities: { ai: true, documentUpload: true } },
}));

const services = vi.hoisted(() => ({
  getGroup: vi.fn(),
  getMeetings: vi.fn(),
  createMeeting: vi.fn(),
  getMeeting: vi.fn(),
  updateMeeting: vi.fn(),
  cancelMeeting: vi.fn(),
  getMeetingMinutes: vi.fn(),
  updateMeetingMinutes: vi.fn(),
  convertActionItemToTask: vi.fn(),
  retryGoogleMeetingSync: vi.fn(),
  getMeetingAttachments: vi.fn(),
  createAttachmentUploadTarget: vi.fn(),
  completeAttachmentUpload: vi.fn(),
  getAttachmentDownloadTarget: vi.fn(),
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
  convertActionItemToTask: services.convertActionItemToTask,
  retryGoogleMeetingSync: services.retryGoogleMeetingSync,
}));

vi.mock('../attachments.service', () => ({
  getMeetingAttachments: services.getMeetingAttachments,
  createAttachmentUploadTarget: services.createAttachmentUploadTarget,
  completeAttachmentUpload: services.completeAttachmentUpload,
  getAttachmentDownloadTarget: services.getAttachmentDownloadTarget,
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
  status = 'SCHEDULED',
) => ({
  id: meetingId,
  groupId: 'group-1',
  title: 'Họp tuần',
  description: 'Agenda overview',
  organizerId,
  attendeeIds: ['admin-1', 'user-1'],
  agenda: [],
  startsAt: '2030-01-01T10:00:00.000Z',
  endsAt: '2030-01-01T11:00:00.000Z',
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
  actionItems: [
    {
      id: 'action-1',
      content: 'Việc A',
      assigneeId: 'user-1',
      dueAt: '2026-08-10T03:30:00.000Z',
      taskId: 'task-1',
    },
  ],
  version: 2,
  createdBy: 'admin-1',
  createdAt: '2026-08-04T03:00:00.000Z',
};

const unconvertedMinutes = (actionItem: Record<string, unknown> = {}) => ({
  ...minutes,
  actionItems: [
    {
      id: 'action-1',
      content: 'Việc A',
      assigneeId: 'user-1',
      dueAt: '2026-08-10T03:30:00.000Z',
      ...actionItem,
    },
  ],
});

const convertedResponse = (source = unconvertedMinutes(), assigneeId = 'user-1') => ({
  task: {
    id: 'task-created',
    groupId: 'group-1',
    title: source.actionItems[0]?.content ?? 'Task',
    assigneeId,
    status: 'TODO',
    priority: 'MEDIUM',
    sourceMeetingId: 'meeting-1',
    sourceActionItemId: 'action-1',
  },
  minutes: {
    ...source,
    version: source.version + 1,
    actionItems: source.actionItems.map((item) => ({ ...item, taskId: 'task-created' })),
  },
});

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
  services.updateMeeting.mockImplementation(
    async (_meetingId: string, request: Record<string, unknown>) => ({
      ...meetingFixture(),
      ...request,
      version: 2,
    }),
  );
  services.cancelMeeting.mockImplementation(
    async (_meetingId: string, request: { reason?: string; version?: number }) => ({
      ...meetingFixture(),
      status: 'CANCELLED',
      cancelledAt: '2029-01-02T00:00:00.000Z',
      cancellationReason: request.reason,
      version: 2,
    }),
  );
  services.getMeetingMinutes.mockRejectedValue(
    new ApiClientError('Chưa có biên bản.', 404, 'NOT_FOUND'),
  );
  services.updateMeetingMinutes.mockReset();
  services.convertActionItemToTask.mockReset();
  services.getMeetingAttachments.mockResolvedValue([]);
  services.createAttachmentUploadTarget.mockReset();
  services.completeAttachmentUpload.mockReset();
  services.getAttachmentDownloadTarget.mockReset();
});

function renderPage(client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
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

function renderDetail(role?: 'MEMBER' | 'GROUP_ADMIN') {
  if (role) services.getGroup.mockResolvedValue(groupDetails(role));
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

const openMinutesEditor = async () => {
  fireEvent.click(await screen.findByRole('button', { name: /^(?:Soạn|Chỉnh sửa) biên bản$/ }));
};

const submitMinutesEditor = () => {
  fireEvent.submit(screen.getByLabelText(/^Tóm tắt/).closest('form')!);
};

it('hiển thị loading state trong khi tải timeline', () => {
  services.getMeetings.mockReturnValue(new Promise(() => undefined));
  renderPage();
  expect(screen.getByRole('status')).toBeInTheDocument();
});

it('không dùng nhầm cache danh sách meeting của trang nhóm làm infinite timeline', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(['groups', 'group-1', 'meetings'], [meetingFixture('cached')]);
  services.getMeetings.mockResolvedValue({ items: [meetingFixture('timeline')] });

  renderPage(client);

  await waitFor(() => expect(services.getMeetings).toHaveBeenCalledWith('group-1', {}));
  expect(await screen.findByText('Họp tuần')).toBeInTheDocument();
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

it('áp dụng agenda preset và xác nhận trước khi ghi đè nội dung hiện có', async () => {
  services.getGroup.mockResolvedValue({
    group: { id: 'group-1', name: 'Nhóm A', role: 'GROUP_ADMIN' },
    members: [],
  });
  renderPage();

  const preset = (await screen.findByLabelText('Mẫu chương trình họp')) as HTMLSelectElement;
  expect(preset).toHaveValue('weekly-progress');
  fireEvent.click(screen.getByRole('button', { name: 'Áp dụng mẫu' }));
  expect(screen.getByDisplayValue('Kết quả công việc tuần qua')).toBeInTheDocument();
  expect(screen.getByLabelText('Tiêu đề mục chương trình 5')).toHaveValue('Kết luận và phân công');

  fireEvent.change(preset, { target: { value: 'kickoff' } });
  fireEvent.click(screen.getByRole('button', { name: 'Áp dụng mẫu' }));
  expect(
    screen.getByText('Áp dụng mẫu mới sẽ thay thế chương trình hiện tại.'),
  ).toBeInTheDocument();
  expect(screen.getByDisplayValue('Kết quả công việc tuần qua')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Áp dụng và thay thế' }));
  expect(screen.getByDisplayValue('Mục tiêu và phạm vi dự án')).toBeInTheDocument();
  expect(screen.queryByDisplayValue('Kết quả công việc tuần qua')).not.toBeInTheDocument();
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

  fireEvent.click(screen.getByText('Tùy chọn hủy cuộc họp'));
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
  fireEvent.submit(screen.getByRole('button', { name: /tạo cuộc họp/i }).closest('form')!);
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

it('chỉ cho tải tài liệu đã sẵn sàng và dùng tên định dạng thân thiện', async () => {
  services.getMeetingAttachments.mockResolvedValue([
    {
      attachmentId: 'attachment-ready',
      meetingId: 'meeting-1',
      groupId: 'group-1',
      fileName: 'ke-hoach.pdf',
      contentType: 'application/pdf',
      sizeBytes: 1_048_576,
      checksum: 'checksum-ready',
      objectKey: 'uploads/group-1/meeting-1/attachment-ready',
      status: 'READY',
      createdAt: '2026-08-08T08:00:00.000Z',
      updatedAt: '2026-08-08T08:01:00.000Z',
      readyAt: '2026-08-08T08:01:00.000Z',
    },
    {
      attachmentId: 'attachment-processing',
      meetingId: 'meeting-1',
      groupId: 'group-1',
      fileName: 'ghi-chu.docx',
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      sizeBytes: 2_097_152,
      checksum: 'checksum-processing',
      objectKey: 'uploads/group-1/meeting-1/attachment-processing',
      status: 'UPLOADED',
      createdAt: '2026-08-08T08:00:00.000Z',
      updatedAt: '2026-08-08T08:01:00.000Z',
    },
  ]);
  services.getAttachmentDownloadTarget.mockResolvedValue({
    attachment: (await services.getMeetingAttachments())[0],
    downloadUrl: 'https://example.com/download',
    downloadExpiresAt: '2026-08-08T08:15:00.000Z',
  });
  const open = vi.spyOn(window, 'open').mockImplementation(() => null);

  renderDetail('MEMBER');

  expect(await screen.findByText('PDF · 1.0 MB')).toBeInTheDocument();
  expect(screen.getByText('Word · 2.0 MB')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Chưa sẵn sàng' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Tải xuống' }));
  await waitFor(() =>
    expect(services.getAttachmentDownloadTarget).toHaveBeenCalledWith('attachment-ready'),
  );
  open.mockRestore();
});

it('không gửi lại metadata đã được ký sẵn trong URL upload S3', async () => {
  const bytes = new TextEncoder().encode('Nội dung kiểm thử upload');
  const file = new File([bytes], 'ghi-chu.txt', { type: 'text/plain' });
  Object.defineProperty(file, 'arrayBuffer', {
    value: vi.fn().mockResolvedValue(bytes.buffer),
  });
  services.createAttachmentUploadTarget.mockResolvedValue({
    attachment: {
      attachmentId: 'attachment-upload',
      meetingId: 'meeting-1',
      groupId: 'group-1',
      fileName: file.name,
      contentType: 'text/plain',
      sizeBytes: file.size,
      checksum: 'signed-checksum',
      objectKey: 'uploads/group-1/meeting-1/attachment-upload',
      status: 'PENDING_UPLOAD',
      createdAt: '2026-08-08T08:00:00.000Z',
      updatedAt: '2026-08-08T08:00:00.000Z',
    },
    uploadUrl: 'https://example.com/signed-upload',
    uploadExpiresAt: '2026-08-08T08:05:00.000Z',
  });
  services.completeAttachmentUpload.mockResolvedValue({
    attachment: {
      ...(await services.createAttachmentUploadTarget()).attachment,
      status: 'UPLOADED',
    },
    aiJob: {
      aiJobId: 'aij-upload',
      groupId: 'group-1',
      meetingId: 'meeting-1',
      type: 'INGEST_SOURCE',
      status: 'QUEUED',
      attempt: 0,
      requestId: 'request-upload',
      provider: 'BEDROCK',
      createdAt: '2026-08-08T08:00:01.000Z',
      updatedAt: '2026-08-08T08:00:01.000Z',
    },
  });
  const uploadFetch = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(new Response(null, { status: 200 }));

  renderDetail('MEMBER');
  fireEvent.change(await screen.findByLabelText('Chọn tài liệu'), {
    target: { files: [file] },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Tải tài liệu lên' }));

  await waitFor(() => expect(uploadFetch).toHaveBeenCalledTimes(1));
  expect(uploadFetch).toHaveBeenCalledWith(
    'https://example.com/signed-upload',
    expect.objectContaining({
      method: 'PUT',
      headers: { 'content-type': 'text/plain' },
      body: file,
    }),
  );
  expect(
    Object.keys((uploadFetch.mock.calls[0]?.[1]?.headers ?? {}) as Record<string, string>),
  ).not.toContain('x-amz-meta-checksum');
  uploadFetch.mockRestore();
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
    expect(screen.getByText('Việc A')).toBeInTheDocument();
    expect(screen.getByText(/Lan · Hạn/)).toBeInTheDocument();
    expect(screen.getByText('Đang theo dõi')).toBeInTheDocument();
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
    const { invalidate } = renderDetail('GROUP_ADMIN');
    expect(await screen.findByText('Chưa có biên bản')).toBeInTheDocument();
    await openMinutesEditor();
    fireEvent.change(screen.getByLabelText(/^Tóm tắt/), {
      target: { value: 'Biên bản đầu' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Thêm quyết định' }));
    fireEvent.change(screen.getByLabelText('Quyết định 1'), {
      target: { value: 'Chốt phương án' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Thêm việc sau cuộc họp' }));
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
    renderDetail('GROUP_ADMIN');
    await openMinutesEditor();
    expect(await screen.findByDisplayValue('Tóm tắt đã lưu')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'An' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Lan' })).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Xóa' })[0]!);
    expect(screen.queryByLabelText('Quyết định 1')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Xóa' }));
    expect(screen.queryByLabelText('Việc cần thực hiện 1')).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Người ngoài nhóm' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^Tóm tắt/), { target: { value: 'Bản sửa' } });
    services.updateMeetingMinutes.mockResolvedValue({ ...minutes, summary: 'Bản sửa', version: 3 });
    submitMinutesEditor();
    await waitFor(() =>
      expect(services.updateMeetingMinutes).toHaveBeenCalledWith(
        'meeting-1',
        expect.objectContaining({ expectedVersion: 2 }),
      ),
    );
  });

  it('round-trips action item identity and due date without sending server taskId', async () => {
    services.getMeetingMinutes.mockResolvedValue(minutes);
    services.updateMeetingMinutes.mockResolvedValue({ ...minutes, version: 3 });
    renderDetail('GROUP_ADMIN');

    await openMinutesEditor();

    const dueAt = (await screen.findByLabelText('Hạn hoàn thành 1')) as HTMLInputElement;
    expect(dueAt).toHaveValue('2026-08-10');
    fireEvent.change(dueAt, { target: { value: '2026-08-11' } });
    fireEvent.change(screen.getByLabelText('Việc cần thực hiện 1'), {
      target: { value: 'Việc A cập nhật' },
    });
    submitMinutesEditor();

    await waitFor(() => expect(services.updateMeetingMinutes).toHaveBeenCalledTimes(1));
    const sent = services.updateMeetingMinutes.mock.calls[0]?.[1];
    expect(sent.actionItems).toEqual([
      {
        id: 'action-1',
        content: 'Việc A cập nhật',
        assigneeId: 'user-1',
        dueAt: new Date('2026-08-11T23:59:59').toISOString(),
      },
    ]);
    expect(sent.actionItems[0]).not.toHaveProperty('taskId');
  });

  it('keeps persisted Decision ids through edit/delete and leaves new Decisions unassigned', async () => {
    const initialMinutes = {
      ...minutes,
      decisions: [
        { id: 'decision-1', content: 'Một' },
        { id: 'decision-2', content: 'Hai' },
      ],
    };
    const savedMinutes = {
      ...minutes,
      decisions: [
        { id: 'decision-2', content: 'Hai cập nhật' },
        { id: 'decision-3', content: 'Mới' },
      ],
      version: 3,
    };
    services.getMeetingMinutes
      .mockResolvedValueOnce(initialMinutes)
      .mockResolvedValue(savedMinutes);
    services.updateMeetingMinutes.mockResolvedValue(savedMinutes);
    renderDetail('GROUP_ADMIN');

    await openMinutesEditor();
    await screen.findByDisplayValue('Một');
    fireEvent.click(screen.getAllByRole('button', { name: 'Xóa' })[0]!);
    fireEvent.change(screen.getByLabelText('Quyết định 1'), {
      target: { value: 'Hai cập nhật' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Thêm quyết định' }));
    fireEvent.change(screen.getByLabelText('Quyết định 2'), { target: { value: 'Mới' } });
    submitMinutesEditor();

    await waitFor(() => expect(services.updateMeetingMinutes).toHaveBeenCalledTimes(1));
    expect(services.updateMeetingMinutes.mock.calls[0]?.[1].decisions).toEqual([
      { id: 'decision-2', content: 'Hai cập nhật' },
      { content: 'Mới' },
    ]);
    expect(await screen.findByText('Hai cập nhật')).toBeInTheDocument();
    expect(screen.getByText('Mới')).toBeInTheDocument();
  });

  it('keeps the remaining action item id after deleting another item', async () => {
    services.getMeetingMinutes.mockResolvedValue({
      ...minutes,
      actionItems: [
        minutes.actionItems[0],
        { id: 'action-2', content: 'Việc B', assigneeId: 'admin-1' },
      ],
    });
    services.updateMeetingMinutes.mockResolvedValue({ ...minutes, version: 3 });
    renderDetail('GROUP_ADMIN');

    await openMinutesEditor();
    await screen.findByDisplayValue('Việc A');
    const deleteButtons = screen.getAllByRole('button', { name: 'Xóa' });
    fireEvent.click(deleteButtons[1]!);
    submitMinutesEditor();

    await waitFor(() => expect(services.updateMeetingMinutes).toHaveBeenCalledTimes(1));
    expect(services.updateMeetingMinutes.mock.calls[0]?.[1].actionItems).toEqual([
      expect.objectContaining({ id: 'action-2', content: 'Việc B' }),
    ]);
  });

  it('locks double submit while pending', async () => {
    let resolveSave!: (value: typeof minutes) => void;
    services.updateMeetingMinutes.mockReturnValue(
      new Promise((resolve) => {
        resolveSave = resolve;
      }),
    );
    renderDetail('GROUP_ADMIN');
    await screen.findByText('Chưa có biên bản');
    await openMinutesEditor();
    fireEvent.change(screen.getByLabelText(/^Tóm tắt/), { target: { value: 'Draft' } });
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
    const { invalidate } = renderDetail('GROUP_ADMIN');
    await openMinutesEditor();
    const summary = (await screen.findByLabelText(/^Tóm tắt/)) as HTMLTextAreaElement;
    fireEvent.change(summary, { target: { value: 'Bản nháp chưa lưu' } });
    fireEvent.click(screen.getByRole('button', { name: 'Thêm quyết định' }));
    fireEvent.change(screen.getByLabelText('Quyết định 2'), {
      target: { value: 'Quyết định nháp' },
    });
    submitMinutesEditor();
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
    renderDetail('GROUP_ADMIN');
    await screen.findByText('Chưa có biên bản');
    await openMinutesEditor();
    fireEvent.change(screen.getByLabelText(/^Tóm tắt/), {
      target: { value: 'Draft version zero' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu biên bản' }));
    expect(await screen.findByText(/Bản nháp của bạn vẫn được giữ/)).toBeInTheDocument();
    expect(screen.getByDisplayValue('Draft version zero')).toBeInTheDocument();
    await waitFor(() => expect(services.getMeetingMinutes).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('button', { name: 'Dùng phiên bản mới làm mốc' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^Tóm tắt/), {
      target: { value: 'Draft vẫn tiếp tục được sửa' },
    });
    expect(screen.getByDisplayValue('Draft vẫn tiếp tục được sửa')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dùng phiên bản mới làm mốc' })).toBeInTheDocument();
  });

  it('shows cancelled Minutes read-only without a save editor', async () => {
    services.getMeeting.mockResolvedValue(meetingFixture('meeting-1', 'admin-1', 'CANCELLED'));
    services.getMeetingMinutes.mockResolvedValue(minutes);
    renderDetail('GROUP_ADMIN');
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
    renderDetail('GROUP_ADMIN');
    await screen.findByText('Chưa có biên bản');
    await openMinutesEditor();
    fireEvent.change(screen.getByLabelText(/^Tóm tắt/), {
      target: { value: 'Draft còn nguyên' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu biên bản' }));
    expect(await screen.findByText(expected)).toBeInTheDocument();
    expect(screen.getByDisplayValue('Draft còn nguyên')).toBeInTheDocument();
  });

  it('shows conversion only to GROUP_ADMIN and reports an existing Task to members', async () => {
    services.getMeetingMinutes.mockResolvedValue(minutes);
    renderDetail('MEMBER');

    expect(await screen.findByText('Đang theo dõi')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Đưa vào danh sách công việc' }),
    ).not.toBeInTheDocument();
  });

  it('shows Create Task for an unconverted persisted Action Item to GROUP_ADMIN', async () => {
    services.getMeetingMinutes.mockResolvedValue(unconvertedMinutes());
    renderDetail('GROUP_ADMIN');

    expect(
      await screen.findByRole('button', { name: 'Đưa vào danh sách công việc' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Đang theo dõi')).not.toBeInTheDocument();
  });

  it('uses persisted id/version, defaults priority, omits blank title and cannot override source assignee', async () => {
    const source = unconvertedMinutes();
    services.getMeetingMinutes.mockResolvedValue(source);
    services.convertActionItemToTask.mockResolvedValue(convertedResponse(source));
    renderDetail('GROUP_ADMIN');

    fireEvent.click(await screen.findByRole('button', { name: 'Đưa vào danh sách công việc' }));
    expect(screen.getByLabelText('Mức ưu tiên cho Việc A')).toHaveValue('MEDIUM');
    expect(screen.queryByLabelText('Người phụ trách công việc Việc A')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận và giao việc' }));

    await waitFor(() => expect(services.convertActionItemToTask).toHaveBeenCalledTimes(1));
    expect(services.convertActionItemToTask).toHaveBeenCalledWith('meeting-1', 'action-1', {
      expectedMinutesVersion: 2,
      priority: 'MEDIUM',
    });
  });

  it('requires an active assignee when the persisted Action Item is unassigned', async () => {
    const source = unconvertedMinutes({ assigneeId: undefined });
    services.getMeetingMinutes.mockResolvedValue(source);
    services.getGroup.mockResolvedValue({
      ...groupDetails('GROUP_ADMIN'),
      members: [
        ...groupDetails('GROUP_ADMIN').members,
        {
          membership: { userId: 'inactive-1', role: 'MEMBER', active: false },
          user: { displayName: 'Không hoạt động', email: 'inactive@example.edu' },
        },
      ],
    });
    services.convertActionItemToTask.mockResolvedValue(convertedResponse(source, 'admin-1'));
    renderDetail();

    fireEvent.click(await screen.findByRole('button', { name: 'Đưa vào danh sách công việc' }));
    const priority = screen.getByLabelText('Mức ưu tiên cho Việc A');
    expect(priority).toHaveValue('MEDIUM');
    expect(screen.getByRole('option', { name: 'Thấp' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Vừa' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Cao' })).toBeInTheDocument();
    const assigneeSelect = screen.getByLabelText('Người phụ trách công việc Việc A');
    expect(
      within(assigneeSelect).queryByRole('option', { name: 'Không hoạt động' }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận và giao việc' }));
    expect(
      await screen.findByText('Vui lòng chọn người phụ trách đang hoạt động.'),
    ).toBeInTheDocument();
    expect(services.convertActionItemToTask).not.toHaveBeenCalled();

    fireEvent.change(assigneeSelect, {
      target: { value: 'admin-1' },
    });
    fireEvent.change(priority, { target: { value: 'HIGH' } });
    fireEvent.change(screen.getByLabelText('Tiêu đề công việc Việc A'), {
      target: { value: ' Task tùy chỉnh ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận và giao việc' }));

    await waitFor(() => expect(services.convertActionItemToTask).toHaveBeenCalledTimes(1));
    expect(services.convertActionItemToTask).toHaveBeenCalledWith('meeting-1', 'action-1', {
      expectedMinutesVersion: 2,
      priority: 'HIGH',
      assigneeId: 'admin-1',
      title: 'Task tùy chỉnh',
    });
  });

  it('requires a title override for source content above the Task title limit', async () => {
    const longContent = 'x'.repeat(201);
    const source = unconvertedMinutes({ content: longContent });
    services.getMeetingMinutes.mockResolvedValue(source);
    services.convertActionItemToTask.mockResolvedValue(convertedResponse(source));
    renderDetail('GROUP_ADMIN');

    fireEvent.click(await screen.findByRole('button', { name: 'Đưa vào danh sách công việc' }));
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận và giao việc' }));
    expect(
      await screen.findByText('Nội dung vượt quá 200 ký tự; vui lòng nhập tiêu đề ngắn gọn.'),
    ).toBeInTheDocument();
    expect(services.convertActionItemToTask).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(`Tiêu đề công việc ${longContent}`), {
      target: { value: 'Tiêu đề hợp lệ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận và giao việc' }));
    await waitFor(() => expect(services.convertActionItemToTask).toHaveBeenCalledTimes(1));
    expect(services.convertActionItemToTask.mock.calls[0]?.[2]).toEqual(
      expect.objectContaining({ title: 'Tiêu đề hợp lệ' }),
    );
  });

  it('disables persisted Action Item conversion while the Minutes draft is dirty', async () => {
    services.getMeetingMinutes.mockResolvedValue(unconvertedMinutes());
    renderDetail('GROUP_ADMIN');

    const create = await screen.findByRole('button', { name: 'Đưa vào danh sách công việc' });
    expect(create).toBeEnabled();
    await openMinutesEditor();
    fireEvent.change(screen.getByLabelText(/^Tóm tắt/), {
      target: { value: 'Draft chưa lưu' },
    });
    expect(screen.queryByRole('button', { name: 'Đưa vào danh sách công việc' })).toBeNull();
    expect(screen.getByText('Chưa lưu')).toBeInTheDocument();
  });

  it('prevents double submit, avoids optimistic taskId, and consumes authoritative Minutes', async () => {
    const source = unconvertedMinutes();
    const response = convertedResponse(source);
    let resolveConversion!: (value: typeof response) => void;
    services.getMeetingMinutes.mockResolvedValue(source);
    services.convertActionItemToTask.mockReturnValue(
      new Promise((resolve) => {
        resolveConversion = resolve;
      }),
    );
    const { client, invalidate } = renderDetail('GROUP_ADMIN');

    fireEvent.click(await screen.findByRole('button', { name: 'Đưa vào danh sách công việc' }));
    const submit = screen.getByRole('button', { name: 'Xác nhận và giao việc' });
    fireEvent.click(submit);
    fireEvent.click(submit);
    await waitFor(() => expect(services.convertActionItemToTask).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', { name: 'Đang tạo…' })).toBeDisabled();
    expect(screen.queryByText('Đang theo dõi')).not.toBeInTheDocument();

    resolveConversion(response);
    expect(await screen.findByText('Đang theo dõi')).toBeInTheDocument();
    expect(client.getQueryData(['meetings', 'meeting-1', 'minutes'])).toEqual(response.minutes);
    expect(screen.getByText(`Phiên bản ${response.minutes.version}`)).toBeInTheDocument();
    await waitFor(() => {
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['tasks'] });
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['dashboard'] });
    });
  });

  it('does not invalidate personal Task or Dashboard caches for another assignee', async () => {
    const source = unconvertedMinutes({ assigneeId: 'admin-1' });
    services.getMeetingMinutes.mockResolvedValue(source);
    services.convertActionItemToTask.mockResolvedValue(convertedResponse(source, 'admin-1'));
    const { invalidate } = renderDetail('GROUP_ADMIN');

    fireEvent.click(await screen.findByRole('button', { name: 'Đưa vào danh sách công việc' }));
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận và giao việc' }));
    expect(await screen.findByText('Đang theo dõi')).toBeInTheDocument();
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: ['tasks'] });
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: ['dashboard'] });
  });

  it('handles lost admin permission and refreshes the exact group query', async () => {
    services.getMeetingMinutes.mockResolvedValue(unconvertedMinutes());
    services.convertActionItemToTask.mockRejectedValue(
      new ApiClientError('Forbidden', 403, 'FORBIDDEN'),
    );
    const { invalidate } = renderDetail('GROUP_ADMIN');

    fireEvent.click(await screen.findByRole('button', { name: 'Đưa vào danh sách công việc' }));
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận và giao việc' }));
    expect(
      await screen.findByText('Bạn không còn quyền Quản trị viên để tạo công việc.'),
    ).toBeInTheDocument();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['groups', 'group-1'] });
  });

  it.each([
    [404, 'Việc cần thực hiện không còn trong phiên bản biên bản mới nhất.'],
    [409, 'Biên bản đã thay đổi hoặc mục này vừa được chuyển thành công việc ở nơi khác.'],
  ])(
    'refetches latest Minutes on conversion error %s and retains valid input',
    async (status, message) => {
      services.getMeetingMinutes.mockResolvedValue(unconvertedMinutes());
      services.convertActionItemToTask.mockRejectedValue(
        new ApiClientError(message, status, status === 404 ? 'NOT_FOUND' : 'CONFLICT'),
      );
      const { invalidate } = renderDetail('GROUP_ADMIN');

      fireEvent.click(await screen.findByRole('button', { name: 'Đưa vào danh sách công việc' }));
      fireEvent.change(screen.getByLabelText('Tiêu đề công việc Việc A'), {
        target: { value: 'Giữ input này' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Xác nhận và giao việc' }));

      expect(await screen.findByText(message)).toBeInTheDocument();
      expect(screen.getByDisplayValue('Giữ input này')).toBeInTheDocument();
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: ['meetings', 'meeting-1', 'minutes'],
      });
    },
  );

  it('drops local conversion input when a 404 refresh removes the Action Item', async () => {
    const source = unconvertedMinutes();
    services.getMeetingMinutes
      .mockResolvedValueOnce(source)
      .mockResolvedValueOnce({ ...source, version: 3, actionItems: [] });
    services.convertActionItemToTask.mockRejectedValue(
      new ApiClientError('Missing', 404, 'NOT_FOUND'),
    );
    renderDetail('GROUP_ADMIN');

    fireEvent.click(await screen.findByRole('button', { name: 'Đưa vào danh sách công việc' }));
    fireEvent.change(screen.getByLabelText('Tiêu đề công việc Việc A'), {
      target: { value: 'Input sẽ bị bỏ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận và giao việc' }));

    await waitFor(() => expect(services.getMeetingMinutes).toHaveBeenCalledTimes(2));
    expect(screen.queryByDisplayValue('Input sẽ bị bỏ')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Đưa vào danh sách công việc' }),
    ).not.toBeInTheDocument();
  });

  it('keeps input on 422 and permits retry after a network/server failure', async () => {
    const source = unconvertedMinutes();
    services.getMeetingMinutes.mockResolvedValue(source);
    services.convertActionItemToTask
      .mockRejectedValueOnce(new ApiClientError('Quy tắc nghiệp vụ', 422, 'UNPROCESSABLE_ENTITY'))
      .mockRejectedValueOnce(new Error('Mất kết nối'))
      .mockResolvedValueOnce(convertedResponse(source));
    renderDetail('GROUP_ADMIN');

    fireEvent.click(await screen.findByRole('button', { name: 'Đưa vào danh sách công việc' }));
    fireEvent.change(screen.getByLabelText('Tiêu đề công việc Việc A'), {
      target: { value: 'Không được mất' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận và giao việc' }));
    expect(await screen.findByText('Quy tắc nghiệp vụ')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Không được mất')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận và giao việc' }));
    expect(await screen.findByText('Mất kết nối')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Không được mất')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận và giao việc' }));
    expect(await screen.findByText('Đang theo dõi')).toBeInTheDocument();
    expect(services.convertActionItemToTask).toHaveBeenCalledTimes(3);
  });
});

it('quản lý agenda khi create, reorder deterministic, trim và giữ draft khi API lỗi', async () => {
  services.getGroup.mockResolvedValue({
    group: { id: 'group-1', name: 'Nhóm A', role: 'GROUP_ADMIN' },
    members: [],
  });
  services.createMeeting.mockRejectedValue(new Error('Không thể tạo meeting'));
  renderPage();

  expect(await screen.findByText('Chưa có mục chương trình nào.')).toBeInTheDocument();
  const add = screen.getByRole('button', { name: 'Thêm mục chương trình' });
  fireEvent.click(add);
  fireEvent.click(add);
  const titles = screen.getAllByLabelText(/Tiêu đề mục chương trình \d+/);
  fireEvent.change(titles[0]!, { target: { value: '  Mục đầu  ' } });
  fireEvent.change(titles[1]!, { target: { value: 'Mục sau' } });

  expect(screen.getByRole('button', { name: 'Di chuyển mục chương trình 1 lên' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Di chuyển mục chương trình 2 xuống' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Di chuyển mục chương trình 2 lên' }));
  fireEvent.change(
    screen.getByLabelText(/tiêu đề/i, { selector: 'input:not([maxlength="200"])' }),
    {
      target: { value: 'Planning' },
    },
  );
  fireEvent.submit(screen.getByRole('button', { name: /tạo cuộc họp/i }).closest('form')!);

  await waitFor(() => expect(services.createMeeting).toHaveBeenCalledTimes(1));
  expect(services.createMeeting.mock.calls[0]?.[1]).toEqual(
    expect.objectContaining({
      agenda: [
        { order: 0, title: 'Mục sau' },
        { order: 1, title: 'Mục đầu' },
      ],
    }),
  );
  expect(await screen.findByText('Không thể tạo meeting')).toBeInTheDocument();
  expect(screen.getByDisplayValue('Mục sau')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Xóa mục chương trình 2' }));
  expect(screen.queryByDisplayValue('Mục đầu')).not.toBeInTheDocument();
});

it('validate đúng agenda item trống và không gửi create request', async () => {
  services.getGroup.mockResolvedValue({
    group: { id: 'group-1', name: 'Nhóm A', role: 'GROUP_ADMIN' },
    members: [],
  });
  renderPage();
  fireEvent.click(await screen.findByRole('button', { name: 'Thêm mục chương trình' }));
  fireEvent.change(
    screen.getByLabelText(/tiêu đề/i, { selector: 'input:not([maxlength="200"])' }),
    {
      target: { value: 'Planning' },
    },
  );
  fireEvent.click(screen.getByRole('button', { name: /tạo cuộc họp/i }));
  expect(await screen.findByText('Mục chương trình cần có tiêu đề.')).toBeInTheDocument();
  expect(services.createMeeting).not.toHaveBeenCalled();
});

it('chặn double submit create khi request đang pending', async () => {
  services.getGroup.mockResolvedValue({
    group: { id: 'group-1', name: 'Nhóm A', role: 'GROUP_ADMIN' },
    members: [],
  });
  services.createMeeting.mockReturnValue(new Promise(() => undefined));
  renderPage();
  fireEvent.change(
    await screen.findByLabelText(/tiêu đề/i, { selector: 'input:not([maxlength="200"])' }),
    { target: { value: 'Planning' } },
  );
  const submit = screen.getByRole('button', { name: /tạo cuộc họp/i });
  fireEvent.click(submit);
  await waitFor(() => expect(submit).toBeDisabled());
  fireEvent.click(submit);
  expect(services.createMeeting).toHaveBeenCalledTimes(1);
});

it.each(['SCHEDULED', 'CANCELLED', 'COMPLETED'])(
  'hiển thị agenda read-only đúng thứ tự với lifecycle %s',
  async (status) => {
    services.getMeeting.mockResolvedValue({
      ...meetingFixture(),
      status,
      agenda: [
        { id: 'agenda-2', order: 1, title: 'Thứ hai', description: 'Chi tiết hai' },
        { id: 'agenda-1', order: 0, title: 'Thứ nhất' },
      ],
    });
    renderDetail();
    const items = await screen.findAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual(['Thứ nhất', 'Thứ haiChi tiết hai']);
    if (status === 'SCHEDULED') return;
    expect(screen.queryByText('Chỉnh sửa cuộc họp')).not.toBeInTheDocument();
  },
);

it('edit nạp, sửa, thêm, xóa, reorder agenda và cập nhật detail/version từ response', async () => {
  services.getGroup.mockResolvedValue({
    group: { id: 'group-1', name: 'Nhóm A', role: 'GROUP_ADMIN' },
    members: [],
  });
  services.getMeeting.mockResolvedValue({
    ...meetingFixture(),
    agenda: [
      { id: 'agenda-1', order: 0, title: 'Một' },
      { id: 'agenda-2', order: 1, title: 'Hai' },
    ],
  });
  services.updateMeeting.mockResolvedValue({
    ...meetingFixture(),
    title: 'Planning',
    version: 2,
    agenda: [
      { id: 'agenda-3', order: 0, title: 'Ba' },
      { id: 'agenda-1', order: 1, title: 'Một mới' },
    ],
  });
  renderDetail();
  fireEvent.click(await screen.findByText('Chỉnh sửa cuộc họp'));
  fireEvent.change(screen.getByDisplayValue('Một'), { target: { value: 'Một mới' } });
  fireEvent.click(screen.getByRole('button', { name: 'Xóa mục chương trình 2' }));
  fireEvent.click(screen.getByRole('button', { name: 'Thêm mục chương trình' }));
  fireEvent.change(screen.getByLabelText('Tiêu đề mục chương trình 2'), {
    target: { value: 'Ba' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Di chuyển mục chương trình 2 lên' }));
  fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));

  await waitFor(() =>
    expect(services.updateMeeting).toHaveBeenCalledWith(
      'meeting-1',
      expect.objectContaining({
        version: 1,
        agenda: [
          { order: 0, title: 'Ba' },
          { id: 'agenda-1', order: 1, title: 'Một mới' },
        ],
      }),
    ),
  );
  expect(await screen.findByText('Ba')).toBeInTheDocument();
});

it('giữ toàn bộ draft và không retry khi update trả 409', async () => {
  services.getGroup.mockResolvedValue({
    group: { id: 'group-1', name: 'Nhóm A', role: 'GROUP_ADMIN' },
    members: [{ membership: { userId: 'admin' }, user: { displayName: 'Admin' } }],
  });
  services.getMeeting.mockResolvedValue({
    ...meetingFixture(),
    attendeeIds: [],
    agenda: [{ id: 'agenda-1', order: 0, title: 'Server cũ' }],
  });
  services.updateMeeting.mockRejectedValue(
    new ApiClientError('Phiên bản đã thay đổi', 409, 'CONFLICT'),
  );
  renderDetail();
  fireEvent.click(await screen.findByText('Chỉnh sửa cuộc họp'));
  fireEvent.change(screen.getByLabelText('Tiêu đề', { selector: 'input:not([maxlength="200"])' }), {
    target: { value: 'Draft title' },
  });
  fireEvent.change(screen.getByDisplayValue('Server cũ'), { target: { value: 'Draft agenda' } });
  fireEvent.click(screen.getByLabelText('Admin'));
  fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));

  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Cuộc họp đã được cập nhật ở nơi khác',
  );
  expect(services.updateMeeting).toHaveBeenCalledTimes(1);
  expect(screen.getByDisplayValue('Draft title')).toBeInTheDocument();
  expect(screen.getByDisplayValue('Draft agenda')).toBeInTheDocument();
  expect(screen.getByLabelText('Admin')).toBeChecked();
  expect(screen.getByRole('button', { name: 'Tải phiên bản mới nhất' })).toBeInTheDocument();
});

it('reload latest cần confirmation, thay draft/version và không tự submit lại', async () => {
  services.getGroup.mockResolvedValue({
    group: { id: 'group-1', name: 'Nhóm A', role: 'GROUP_ADMIN' },
    members: [],
  });
  const latest = {
    ...meetingFixture(),
    title: 'Server latest',
    version: 2,
    agenda: [{ id: 'latest-agenda', order: 0, title: 'Latest agenda' }],
  };
  services.getMeeting.mockResolvedValueOnce(meetingFixture()).mockResolvedValueOnce(latest);
  services.updateMeeting.mockRejectedValue(
    new ApiClientError('Phiên bản đã thay đổi', 409, 'CONFLICT'),
  );
  const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
  renderDetail();
  fireEvent.click(await screen.findByText('Chỉnh sửa cuộc họp'));
  fireEvent.change(screen.getByLabelText('Tiêu đề', { selector: 'input:not([maxlength="200"])' }), {
    target: { value: 'Draft' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
  const reload = await screen.findByRole('button', { name: 'Tải phiên bản mới nhất' });
  fireEvent.click(reload);
  expect(screen.getByDisplayValue('Draft')).toBeInTheDocument();
  expect(services.getMeeting).toHaveBeenCalledTimes(1);
  fireEvent.click(reload);
  expect(await screen.findByText('Đã tải phiên bản cuộc họp mới nhất.')).toBeInTheDocument();
  expect(screen.getByDisplayValue('Server latest')).toBeInTheDocument();
  expect(screen.getByDisplayValue('Latest agenda')).toBeInTheDocument();
  expect(services.getMeeting).toHaveBeenCalledTimes(2);
  expect(services.updateMeeting).toHaveBeenCalledTimes(1);
  confirm.mockRestore();
});

it('reload latest thất bại giữ draft và cho phép retry', async () => {
  services.getGroup.mockResolvedValue({
    group: { id: 'group-1', name: 'Nhóm A', role: 'GROUP_ADMIN' },
    members: [],
  });
  services.getMeeting
    .mockResolvedValueOnce(meetingFixture())
    .mockRejectedValueOnce(new Error('Mất kết nối'))
    .mockResolvedValueOnce({ ...meetingFixture(), title: 'Đã tải lại', version: 2 });
  services.updateMeeting.mockRejectedValue(
    new ApiClientError('Phiên bản đã thay đổi', 409, 'CONFLICT'),
  );
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
  renderDetail();
  fireEvent.click(await screen.findByText('Chỉnh sửa cuộc họp'));
  fireEvent.change(screen.getByLabelText('Tiêu đề', { selector: 'input:not([maxlength="200"])' }), {
    target: { value: 'Draft giữ lại' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Tải phiên bản mới nhất' }));
  expect(
    await screen.findByText(/Không thể tải phiên bản mới nhất: Mất kết nối/),
  ).toBeInTheDocument();
  expect(screen.getByDisplayValue('Draft giữ lại')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Tải phiên bản mới nhất' }));
  expect(await screen.findByDisplayValue('Đã tải lại')).toBeInTheDocument();
  confirm.mockRestore();
});

it('update lỗi 422 dùng validation message và không hiển thị conflict action', async () => {
  services.getGroup.mockResolvedValue({
    group: { id: 'group-1', name: 'Nhóm A', role: 'GROUP_ADMIN' },
    members: [],
  });
  services.updateMeeting.mockRejectedValue(
    new ApiClientError('Agenda không hợp lệ', 422, 'INVALID'),
  );
  renderDetail();
  fireEvent.click(await screen.findByText('Chỉnh sửa cuộc họp'));
  fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Thông tin cuộc họp chưa hợp lệ. Vui lòng kiểm tra các trường và thử lại.',
  );
  expect(screen.queryByRole('button', { name: 'Tải phiên bản mới nhất' })).not.toBeInTheDocument();
});

it('timeline hiển thị text status và giữ completed/cancelled trong lịch sử', async () => {
  services.getMeetings.mockResolvedValue([
    { ...meetingFixture('scheduled'), title: 'Meeting scheduled', status: 'SCHEDULED' },
    { ...meetingFixture('completed'), title: 'Meeting completed', status: 'COMPLETED' },
    { ...meetingFixture('cancelled'), title: 'Meeting cancelled', status: 'CANCELLED' },
  ]);
  renderPage();

  expect(await screen.findByText('Meeting scheduled')).toBeInTheDocument();
  expect(screen.getByText('Đã lên lịch')).toBeInTheDocument();
  expect(screen.getByText('Meeting completed')).toBeInTheDocument();
  expect(screen.getByText('Đã hoàn thành')).toBeInTheDocument();
  expect(screen.getByText('Meeting cancelled')).toBeInTheDocument();
  expect(screen.getByText('Đã hủy')).toBeInTheDocument();
  expect(screen.getByText('Lịch sử (2)')).toBeInTheDocument();
});

it('detail cancelled hiển thị reason/time nhưng không lộ cancelledBy technical ID', async () => {
  services.getMeeting.mockResolvedValue({
    ...meetingFixture(),
    status: 'CANCELLED',
    cancellationReason: 'Phòng học không khả dụng',
    cancelledAt: '2029-01-02T00:00:00.000Z',
    cancelledBy: 'technical-user-id',
  });
  renderDetail();

  expect(await screen.findByText('Đã hủy')).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Thông tin hủy' })).toBeInTheDocument();
  expect(screen.getByText(/Phòng học không khả dụng/)).toBeInTheDocument();
  expect(screen.getByText(/02\/01\/2029/)).toBeInTheDocument();
  expect(screen.queryByText('technical-user-id')).not.toBeInTheDocument();
  expect(screen.queryByText('Chỉnh sửa cuộc họp')).not.toBeInTheDocument();
});

it('detail cancelled không tạo placeholder metadata khi contract không có dữ liệu', async () => {
  services.getMeeting.mockResolvedValue({ ...meetingFixture(), status: 'CANCELLED' });
  renderDetail();
  expect(await screen.findByText('Đã hủy')).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Thông tin hủy' })).not.toBeInTheDocument();
});

it.each([
  ['PENDING', /Google Meet đang được đồng bộ/],
  ['FAILED', 'Đồng bộ Google Calendar/Meet thất bại.'],
  ['ACTION_REQUIRED', 'Cần kết nối lại tài khoản Google để đồng bộ cuộc họp.'],
])('hiển thị Google sync status %s độc lập với Meeting lifecycle', async (status, message) => {
  services.getMeeting.mockResolvedValue({
    ...meetingFixture(),
    googleSync: { provider: 'GOOGLE', status },
  });
  renderDetail();
  expect(await screen.findByText(message)).toBeInTheDocument();
  expect(screen.getByText('Đã lên lịch')).toBeInTheDocument();
});

it('chỉ hiển thị trusted Meet URL khi sync đã thành công', async () => {
  services.getMeeting.mockResolvedValue({
    ...meetingFixture(),
    googleSync: {
      provider: 'GOOGLE',
      status: 'SYNCED',
      meetUrl: 'https://meet.google.com/abc-defg-hij',
    },
  });
  renderDetail();
  expect(await screen.findByRole('link', { name: 'Tham gia Google Meet' })).toHaveAttribute(
    'href',
    'https://meet.google.com/abc-defg-hij',
  );
});

it('validate title whitespace và time range tại đúng field, không gọi mutation', async () => {
  services.getGroup.mockResolvedValue({
    group: { id: 'group-1', name: 'Nhóm A', role: 'GROUP_ADMIN' },
    members: [],
  });
  renderPage();
  const title = await screen.findByLabelText('Tiêu đề', {
    selector: 'input:not([maxlength="200"])',
  });
  fireEvent.change(title, { target: { value: '   ' } });
  fireEvent.submit(screen.getByRole('button', { name: 'Tạo cuộc họp' }).closest('form')!);
  const titleError = await screen.findByText('Tiêu đề cần ít nhất 2 ký tự.');
  expect(title).toHaveAttribute('aria-describedby', titleError.id);
  expect(services.createMeeting).not.toHaveBeenCalled();

  fireEvent.change(title, { target: { value: 'Planning' } });
  const start = screen.getByLabelText('Bắt đầu');
  const end = screen.getByLabelText('Kết thúc');
  fireEvent.change(start, { target: { value: '10:00' } });
  fireEvent.change(end, { target: { value: '09:45' } });
  fireEvent.submit(screen.getByRole('button', { name: 'Tạo cuộc họp' }).closest('form')!);
  const timeError = await screen.findByText('Giờ kết thúc phải sau giờ bắt đầu.');
  expect(start).toHaveAttribute('aria-describedby', timeError.id);
  expect(end).toHaveAttribute('aria-describedby', timeError.id);
  expect(services.createMeeting).not.toHaveBeenCalled();
});

it('cancel gửi reason đã trim/version và cập nhật detail cache ngay', async () => {
  services.getGroup.mockResolvedValue({
    group: { id: 'group-1', name: 'Nhóm A', role: 'GROUP_ADMIN' },
    members: [],
  });
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
  renderDetail();
  fireEvent.click(await screen.findByText('Chỉnh sửa cuộc họp'));
  fireEvent.change(screen.getByLabelText('Lý do hủy (không bắt buộc)'), {
    target: { value: '  Trùng lịch học  ' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Hủy cuộc họp' }));

  await waitFor(() =>
    expect(services.cancelMeeting).toHaveBeenCalledWith('meeting-1', {
      reason: 'Trùng lịch học',
      version: 1,
    }),
  );
  expect(await screen.findByText('Đã hủy')).toBeInTheDocument();
  expect(screen.getByText(/Trùng lịch học/)).toBeInTheDocument();
  expect(screen.queryByText('Chỉnh sửa cuộc họp')).not.toBeInTheDocument();
  confirm.mockRestore();
});

it('cancel reason vượt contract limit hiển thị field error và không gọi API', async () => {
  services.getGroup.mockResolvedValue({
    group: { id: 'group-1', name: 'Nhóm A', role: 'GROUP_ADMIN' },
    members: [],
  });
  const confirm = vi.spyOn(window, 'confirm');
  renderDetail();
  fireEvent.click(await screen.findByText('Chỉnh sửa cuộc họp'));
  const reason = screen.getByLabelText('Lý do hủy (không bắt buộc)');
  fireEvent.change(reason, { target: { value: 'x'.repeat(501) } });
  fireEvent.click(screen.getByRole('button', { name: 'Hủy cuộc họp' }));
  const error = await screen.findByText('Lý do hủy không được vượt quá 500 ký tự.');
  expect(reason).toHaveAttribute('aria-describedby', error.id);
  expect(confirm).not.toHaveBeenCalled();
  expect(services.cancelMeeting).not.toHaveBeenCalled();
  confirm.mockRestore();
});

it.each([
  [403, 'Bạn không có quyền thực hiện thao tác này với cuộc họp.'],
  [422, 'Thông tin cuộc họp chưa hợp lệ. Vui lòng kiểm tra các trường và thử lại.'],
  [500, 'CampusMeet đang tạm thời gặp sự cố. Dữ liệu của bạn vẫn được giữ, vui lòng thử lại.'],
])('map update HTTP %s nhưng vẫn giữ form', async (status, expected) => {
  services.getGroup.mockResolvedValue({
    group: { id: 'group-1', name: 'Nhóm A', role: 'GROUP_ADMIN' },
    members: [],
  });
  services.updateMeeting.mockRejectedValue(new ApiClientError('raw server error', status, 'ERROR'));
  renderDetail();
  fireEvent.click(await screen.findByText('Chỉnh sửa cuộc họp'));
  const title = screen.getByLabelText('Tiêu đề', {
    selector: 'input:not([maxlength="200"])',
  });
  fireEvent.change(title, { target: { value: 'Draft vẫn còn' } });
  fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(expected);
  expect(screen.getByDisplayValue('Draft vẫn còn')).toBeInTheDocument();
  expect(services.updateMeeting).toHaveBeenCalledTimes(1);
});

it('detail 404 có message chuyên biệt và retry', async () => {
  services.getMeeting.mockRejectedValue(
    new ApiClientError('raw not found', 404, 'RESOURCE_NOT_FOUND'),
  );
  renderDetail();
  expect(
    await screen.findByText('Cuộc họp không tồn tại hoặc bạn không thể truy cập.'),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
  await waitFor(() => expect(services.getMeeting).toHaveBeenCalledTimes(2));
});
