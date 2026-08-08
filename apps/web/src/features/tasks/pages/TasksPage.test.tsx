// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { GroupRole, Priority } from '@campusmeet/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError } from '../../../lib/api-client';
import { TasksPage } from './TasksPage';

const services = vi.hoisted(() => ({
  getTasks: vi.fn(),
  createTask: vi.fn(),
  updateTaskStatus: vi.fn(),
  getGroups: vi.fn(),
  getGroup: vi.fn(),
  getAllMeetings: vi.fn(),
}));
vi.mock('../service', () => ({
  getTasks: services.getTasks,
  createTask: services.createTask,
  updateTaskStatus: services.updateTaskStatus,
}));
vi.mock('../../groups/service', () => ({
  getGroups: services.getGroups,
  getGroup: services.getGroup,
}));
vi.mock('../../meetings/service', () => ({ getAllMeetings: services.getAllMeetings }));

const adminGroup = {
  id: 'group-1',
  name: 'Nhóm quản trị',
  role: GroupRole.GROUP_ADMIN,
  createdBy: 'admin-1',
  createdAt: '2026-08-01T00:00:00.000Z',
  joinedAt: '2026-08-01T00:00:00.000Z',
};
const memberGroup = {
  ...adminGroup,
  id: 'group-2',
  name: 'Nhóm thành viên',
  role: GroupRole.MEMBER,
};
const groupDetails = {
  group: adminGroup,
  members: [
    {
      membership: {
        id: 'group-1:admin-1',
        groupId: 'group-1',
        userId: 'admin-1',
        role: GroupRole.GROUP_ADMIN,
        active: true,
        joinedAt: '2026-08-01T00:00:00.000Z',
      },
      user: { id: 'admin-1', email: 'admin@example.edu', displayName: 'An' },
    },
    {
      membership: {
        id: 'group-1:user-2',
        groupId: 'group-1',
        userId: 'user-2',
        role: GroupRole.MEMBER,
        active: true,
        joinedAt: '2026-08-01T00:00:00.000Z',
      },
      user: { id: 'user-2', email: 'lan@example.edu', displayName: 'Lan' },
    },
  ],
};

const renderPage = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <TasksPage />
      </QueryClientProvider>,
    ),
  };
};

const enableCreateForm = () => {
  services.getGroups.mockResolvedValue([adminGroup, memberGroup]);
  services.getGroup.mockResolvedValue(groupDetails);
  services.getAllMeetings.mockResolvedValue([
    {
      id: 'meeting-1',
      groupId: 'group-1',
      title: 'Họp tuần',
      organizerId: 'admin-1',
      attendeeIds: [],
      startsAt: '2026-08-10T02:00:00.000Z',
      endsAt: '2026-08-10T03:00:00.000Z',
      status: 'SCHEDULED',
      integrationStatus: 'NOT_CONNECTED',
    },
  ]);
};

const fillRequiredFields = async (title = ' Task mới ') => {
  fireEvent.change(await screen.findByLabelText('Tiêu đề'), { target: { value: title } });
  await screen.findByRole('option', { name: 'Lan' });
  fireEvent.change(screen.getByLabelText('Người phụ trách'), { target: { value: 'user-2' } });
};

const submitForm = () => {
  const button = screen.getByRole('button', { name: /Tạo công việc|Đang tạo/ });
  fireEvent.submit(button.closest('form')!);
};

describe('TasksPage', () => {
  beforeEach(() => {
    services.getTasks.mockReset().mockResolvedValue([]);
    services.createTask.mockReset();
    services.updateTaskStatus.mockReset();
    services.getGroups.mockReset().mockResolvedValue([]);
    services.getGroup.mockReset();
    services.getAllMeetings.mockReset();
    vi.spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000001')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000002')
      .mockReturnValue('00000000-0000-4000-8000-000000000003');
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('shows GET loading, error, empty, and success states', async () => {
    services.getTasks.mockReturnValueOnce(new Promise(() => undefined));
    const first = renderPage();
    expect(screen.getByText('Đang tải công việc…')).toHaveAttribute('role', 'status');
    first.unmount();

    services.getTasks.mockRejectedValueOnce(new Error('network'));
    const second = renderPage();
    expect(await screen.findByText('Chưa thể tải công việc')).toBeInTheDocument();
    second.unmount();

    services.getTasks.mockResolvedValueOnce([]);
    const third = renderPage();
    expect(await screen.findByText('Chưa có công việc được giao')).toBeInTheDocument();
    third.unmount();

    services.getTasks.mockResolvedValueOnce([
      {
        id: 'task-1',
        groupId: 'group-1',
        title: 'Hoàn thiện báo cáo',
        assigneeId: 'admin-1',
        status: 'TODO',
        priority: 'HIGH',
      },
    ]);
    renderPage();
    expect(await screen.findByText('Hoàn thiện báo cáo')).toBeInTheDocument();
    expect(screen.getByText('Ưu tiên: Cao')).toBeInTheDocument();
    expect(screen.getByText('Chưa làm')).toBeInTheDocument();
  });

  it('shows status actions allowed for TODO, DOING, and DONE', async () => {
    services.getTasks.mockResolvedValue([
      {
        id: 'task-todo',
        groupId: 'group-1',
        title: 'Task TODO',
        assigneeId: 'admin-1',
        status: 'TODO',
        priority: 'HIGH',
        version: 1,
      },
      {
        id: 'task-doing',
        groupId: 'group-1',
        title: 'Task DOING',
        assigneeId: 'admin-1',
        status: 'DOING',
        priority: 'MEDIUM',
        version: 2,
      },
      {
        id: 'task-done',
        groupId: 'group-1',
        title: 'Task DONE',
        assigneeId: 'admin-1',
        status: 'DONE',
        priority: 'LOW',
        version: 3,
      },
    ]);
    renderPage();

    expect(await screen.findByRole('button', { name: 'Bắt đầu' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Hoàn thành' })).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Chuyển về Chưa làm' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mở lại' })).toBeInTheDocument();
  });

  it('sends legacy version 0 and prevents a double status update while pending', async () => {
    services.getTasks.mockResolvedValue([
      {
        id: 'task-1',
        groupId: 'group-1',
        title: 'Task TODO',
        assigneeId: 'admin-1',
        status: 'TODO',
        priority: 'HIGH',
      },
    ]);
    services.updateTaskStatus.mockReturnValue(new Promise(() => undefined));
    renderPage();

    const startButton = await screen.findByRole('button', { name: 'Bắt đầu' });
    fireEvent.click(startButton);
    fireEvent.click(startButton);
    await waitFor(() =>
      expect(services.updateTaskStatus).toHaveBeenCalledWith('task-1', {
        status: 'DOING',
        expectedVersion: 0,
      }),
    );
    expect(services.updateTaskStatus).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole('button', { name: 'Đang cập nhật…' })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Đang cập nhật…' })[0]).toBeDisabled();
  });

  it('invalidates tasks after a successful status update', async () => {
    const todo = {
      id: 'task-1',
      groupId: 'group-1',
      title: 'Task TODO',
      assigneeId: 'admin-1',
      status: 'TODO',
      priority: 'HIGH',
      version: 1,
    };
    services.getTasks.mockResolvedValue([todo]);
    services.updateTaskStatus.mockResolvedValue({ ...todo, status: 'DOING', version: 2 });
    const { client } = renderPage();
    const invalidate = vi.spyOn(client, 'invalidateQueries');

    fireEvent.click(await screen.findByRole('button', { name: 'Bắt đầu' }));
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['tasks'] }));
  });

  it('refetches after a 409 and keeps the rendered status unchanged', async () => {
    const todo = {
      id: 'task-1',
      groupId: 'group-1',
      title: 'Task TODO',
      assigneeId: 'admin-1',
      status: 'TODO',
      priority: 'HIGH',
      version: 1,
    };
    services.getTasks.mockResolvedValue([todo]);
    services.updateTaskStatus.mockRejectedValue(new ApiClientError('conflict', 409, 'CONFLICT'));
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Bắt đầu' }));
    expect(
      await screen.findByText(
        'Công việc đã được cập nhật ở nơi khác. Danh sách đang được làm mới.',
      ),
    ).toBeInTheDocument();
    await waitFor(() => expect(services.getTasks.mock.calls.length).toBeGreaterThan(1));
    expect(screen.getByText('Chưa làm')).toBeInTheDocument();
  });

  it.each([
    [403, 'Bạn không có quyền cập nhật công việc này.'],
    [422, 'Không thể chuyển sang trạng thái công việc đã chọn.'],
  ])('shows status error %s without applying an optimistic status', async (status, message) => {
    services.getTasks.mockResolvedValue([
      {
        id: 'task-1',
        groupId: 'group-1',
        title: 'Task TODO',
        assigneeId: 'admin-1',
        status: 'TODO',
        priority: 'HIGH',
        version: 1,
      },
    ]);
    services.updateTaskStatus.mockRejectedValue(
      new ApiClientError('status error', status, `ERROR_${status}`),
    );
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Hoàn thành' }));
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.getByText('Chưa làm')).toBeInTheDocument();
    expect(screen.queryByText('Đang làm')).not.toBeInTheDocument();
  });

  it('only offers GROUP_ADMIN groups and hides the form without one', async () => {
    services.getGroups.mockResolvedValueOnce([memberGroup]);
    const first = renderPage();
    expect(
      await screen.findByText('Bạn cần là Quản trị viên nhóm để tạo công việc.'),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Tiêu đề')).not.toBeInTheDocument();
    first.unmount();

    enableCreateForm();
    renderPage();
    const groupSelect = (await screen.findByLabelText('Nhóm')) as HTMLSelectElement;
    expect([...groupSelect.options].map(({ text }) => text)).toEqual(['Nhóm quản trị']);
  });

  it('loads members and every meeting from the selected admin group', async () => {
    enableCreateForm();
    renderPage();
    expect(await screen.findByRole('option', { name: 'Lan' })).toBeInTheDocument();
    expect(await screen.findByRole('option', { name: 'Họp tuần' })).toBeInTheDocument();
    expect(services.getGroup).toHaveBeenCalledWith('group-1');
    expect(services.getAllMeetings).toHaveBeenCalledWith('group-1');
  });

  it('resets assignee and meeting when the admin group changes', async () => {
    const secondAdmin = { ...adminGroup, id: 'group-3', name: 'Nhóm quản trị B' };
    services.getGroups.mockResolvedValue([adminGroup, secondAdmin]);
    services.getGroup.mockResolvedValue(groupDetails);
    services.getAllMeetings.mockResolvedValue([{ id: 'meeting-1', title: 'Họp tuần' }]);
    renderPage();
    fireEvent.change(await screen.findByLabelText('Người phụ trách'), {
      target: { value: 'user-2' },
    });
    fireEvent.change(screen.getByLabelText('Cuộc họp'), {
      target: { value: 'meeting-1' },
    });
    fireEvent.change(screen.getByLabelText('Nhóm'), { target: { value: 'group-3' } });
    expect(screen.getByLabelText('Người phụ trách')).toHaveValue('');
    expect(screen.getByLabelText('Cuộc họp')).toHaveValue('');
  });

  it('validates title before sending', async () => {
    enableCreateForm();
    renderPage();
    await screen.findByLabelText('Tiêu đề');
    await screen.findByRole('option', { name: 'Lan' });
    fireEvent.change(screen.getByLabelText('Người phụ trách'), { target: { value: 'user-2' } });
    submitForm();
    expect(await screen.findByRole('alert')).toHaveTextContent('Thông tin công việc chưa hợp lệ');
    expect(services.createTask).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Tiêu đề'), { target: { value: 'x'.repeat(201) } });
    submitForm();
    expect(services.createTask).not.toHaveBeenCalled();
  });

  it('sends normalized shared input and omits empty optional fields', async () => {
    enableCreateForm();
    services.createTask.mockResolvedValue({
      id: 'task-1',
      groupId: 'group-1',
      title: 'Task mới',
      assigneeId: 'user-2',
      priority: Priority.MEDIUM,
      status: 'TODO',
      createdBy: 'admin-1',
    });
    renderPage();
    await fillRequiredFields();
    submitForm();
    await waitFor(() => expect(services.createTask).toHaveBeenCalledTimes(1));
    expect(services.createTask.mock.calls[0]?.[0]).toEqual({
      groupId: 'group-1',
      title: 'Task mới',
      assigneeId: 'user-2',
      priority: Priority.MEDIUM,
    });
    expect(services.createTask.mock.calls[0]?.[1]).toBe('00000000-0000-4000-8000-000000000001');
  });

  it('uses the end of the selected due date and sends an optional meeting', async () => {
    enableCreateForm();
    services.createTask.mockResolvedValue({
      id: 'task-1',
      groupId: 'group-1',
      title: 'Task mới',
      assigneeId: 'user-2',
      priority: Priority.HIGH,
      status: 'TODO',
      createdBy: 'admin-1',
    });
    renderPage();
    await fillRequiredFields();
    fireEvent.change(screen.getByLabelText('Mức ưu tiên'), { target: { value: Priority.HIGH } });
    fireEvent.change(screen.getByLabelText('Hạn hoàn thành (không bắt buộc)'), {
      target: { value: '2026-08-10' },
    });
    fireEvent.change(await screen.findByLabelText('Cuộc họp'), {
      target: { value: 'meeting-1' },
    });
    submitForm();
    await waitFor(() => expect(services.createTask).toHaveBeenCalled());
    expect(services.createTask.mock.calls[0]?.[0]).toMatchObject({
      priority: Priority.HIGH,
      dueAt: new Date('2026-08-10T23:59:59').toISOString(),
      sourceMeetingId: 'meeting-1',
    });
  });

  it('prevents a double submit while the mutation is pending', async () => {
    enableCreateForm();
    services.createTask.mockReturnValue(new Promise(() => undefined));
    renderPage();
    await fillRequiredFields();
    submitForm();
    submitForm();
    await waitFor(() => expect(services.createTask).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', { name: 'Đang tạo…' })).toBeDisabled();
  });

  it('reuses a key for equivalent normalized retries and creates a new key after a field changes', async () => {
    enableCreateForm();
    services.createTask
      .mockRejectedValueOnce(new Error('Mất mạng'))
      .mockRejectedValueOnce(new Error('Mất mạng'))
      .mockResolvedValueOnce({
        id: 'task-1',
        groupId: 'group-1',
        title: 'Task khác',
        assigneeId: 'user-2',
        priority: Priority.MEDIUM,
        status: 'TODO',
        createdBy: 'admin-1',
      });
    renderPage();
    await fillRequiredFields(' Task mới ');
    submitForm();
    await screen.findByText('Mất mạng');
    fireEvent.change(screen.getByLabelText('Tiêu đề'), { target: { value: 'Task mới' } });
    submitForm();
    await waitFor(() => expect(services.createTask).toHaveBeenCalledTimes(2));
    expect(services.createTask.mock.calls[1]?.[1]).toBe(services.createTask.mock.calls[0]?.[1]);
    await screen.findByText('Mất mạng');
    fireEvent.change(screen.getByLabelText('Tiêu đề'), { target: { value: 'Task khác' } });
    submitForm();
    await waitFor(() => expect(services.createTask).toHaveBeenCalledTimes(3));
    expect(services.createTask.mock.calls[2]?.[1]).not.toBe(services.createTask.mock.calls[1]?.[1]);
  });

  it('invalidates tasks, keeps group, resets fields, and does not optimistic-add another user task', async () => {
    enableCreateForm();
    services.createTask.mockResolvedValue({
      id: 'new-task',
      groupId: 'group-1',
      title: 'Task mới',
      assigneeId: 'user-2',
      priority: Priority.MEDIUM,
      status: 'TODO',
      createdBy: 'admin-1',
    });
    const { client } = renderPage();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    await fillRequiredFields();
    submitForm();
    expect(await screen.findByText('Đã tạo công việc và giao cho Lan.')).toBeInTheDocument();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['tasks'] });
    expect(screen.queryByText('Task mới')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Nhóm')).toHaveValue('group-1');
    expect(screen.getByLabelText('Tiêu đề')).toHaveValue('');
    expect(screen.getByLabelText('Người phụ trách')).toHaveValue('');
    expect(screen.getByLabelText('Mức ưu tiên')).toHaveValue(Priority.MEDIUM);
  });

  it('shows a distinct success message when assigning to the authenticated admin', async () => {
    enableCreateForm();
    services.getTasks.mockResolvedValueOnce([]).mockResolvedValue([
      {
        id: 'task-1',
        groupId: 'group-1',
        title: 'Task của tôi',
        assigneeId: 'admin-1',
        priority: Priority.MEDIUM,
        status: 'TODO',
        createdBy: 'admin-1',
      },
    ]);
    services.createTask.mockResolvedValue({
      id: 'task-1',
      groupId: 'group-1',
      title: 'Task của tôi',
      assigneeId: 'admin-1',
      priority: Priority.MEDIUM,
      status: 'TODO',
      createdBy: 'admin-1',
    });
    renderPage();
    fireEvent.change(await screen.findByLabelText('Tiêu đề'), {
      target: { value: 'Task của tôi' },
    });
    await screen.findByRole('option', { name: 'An' });
    fireEvent.change(screen.getByLabelText('Người phụ trách'), { target: { value: 'admin-1' } });
    submitForm();
    expect(await screen.findByText('Đã tạo công việc và giao cho bạn.')).toBeInTheDocument();
    expect(await screen.findByText('Task của tôi')).toBeInTheDocument();
  });

  it('clears the idempotency attempt after a 409 response', async () => {
    enableCreateForm();
    services.createTask
      .mockRejectedValueOnce(new ApiClientError('conflict', 409, 'CONFLICT'))
      .mockResolvedValueOnce({
        id: 'task-1',
        groupId: 'group-1',
        title: 'Task mới',
        assigneeId: 'user-2',
        priority: Priority.MEDIUM,
        status: 'TODO',
        createdBy: 'admin-1',
      });
    renderPage();
    await fillRequiredFields();
    submitForm();
    await screen.findByText('Yêu cầu tạo công việc bị xung đột. Vui lòng gửi lại.');
    submitForm();
    await waitFor(() => expect(services.createTask).toHaveBeenCalledTimes(2));
    expect(services.createTask.mock.calls[1]?.[1]).not.toBe(services.createTask.mock.calls[0]?.[1]);
  });

  it('clears a stale 404 error when the reset source meeting select receives focus', async () => {
    enableCreateForm();
    services.createTask.mockRejectedValueOnce(
      new ApiClientError('missing meeting', 404, 'NOT_FOUND'),
    );
    renderPage();
    await fillRequiredFields();
    const meetingSelect = await screen.findByLabelText('Cuộc họp');
    fireEvent.change(meetingSelect, { target: { value: 'meeting-1' } });
    submitForm();

    expect(
      await screen.findByText('Cuộc họp đã chọn không còn tồn tại trong nhóm.'),
    ).toBeInTheDocument();
    expect(meetingSelect).toHaveValue('');
    await screen.findByRole('option', { name: 'Họp tuần' });
    fireEvent.focus(meetingSelect);

    expect(meetingSelect).toHaveValue('');
    expect(
      screen.queryByText('Cuộc họp đã chọn không còn tồn tại trong nhóm.'),
    ).not.toBeInTheDocument();
  });

  it.each([
    [400, 'Thông tin công việc chưa hợp lệ.'],
    [403, 'Bạn không còn quyền Quản trị viên của nhóm này.'],
    [404, 'Cuộc họp đã chọn không còn tồn tại trong nhóm.'],
    [409, 'Yêu cầu tạo công việc bị xung đột. Vui lòng gửi lại.'],
    [422, 'Người phụ trách không còn là thành viên hoạt động của nhóm.'],
  ])('handles task API status %s', async (status, message) => {
    enableCreateForm();
    services.createTask.mockRejectedValue(
      new ApiClientError('server message', status, `ERROR_${status}`),
    );
    const { client } = renderPage();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    await fillRequiredFields();
    if (status === 404) {
      fireEvent.change(await screen.findByLabelText('Cuộc họp'), {
        target: { value: 'meeting-1' },
      });
    }
    submitForm();
    expect(await screen.findByText(message)).toBeInTheDocument();
    if (status === 403) expect(invalidate).toHaveBeenCalledWith({ queryKey: ['groups'] });
    if (status === 404) {
      expect(screen.getByLabelText('Cuộc họp')).toHaveValue('');
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['groups', 'group-1', 'meetings'] });
    }
    if (status === 422) {
      expect(screen.getByLabelText('Người phụ trách')).toHaveValue('');
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['groups', 'group-1'] });
    }
  });

  it('allows creation without a source meeting when the meeting query fails', async () => {
    enableCreateForm();
    services.getAllMeetings.mockRejectedValue(new Error('meeting network'));
    services.createTask.mockResolvedValue({
      id: 'task-1',
      groupId: 'group-1',
      title: 'Task mới',
      assigneeId: 'user-2',
      priority: Priority.MEDIUM,
      status: 'TODO',
      createdBy: 'admin-1',
    });
    renderPage();
    await fillRequiredFields();
    expect(
      await screen.findByText('Bạn vẫn có thể tạo công việc không liên kết cuộc họp.'),
    ).toBeInTheDocument();
    submitForm();
    await waitFor(() => expect(services.createTask).toHaveBeenCalled());
    expect(services.createTask.mock.calls[0]?.[0]).not.toHaveProperty('sourceMeetingId');
  });
});
