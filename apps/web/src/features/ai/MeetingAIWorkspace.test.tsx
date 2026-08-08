// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  GroupRole,
  Priority,
  type AIJob,
  type AIJobDetail,
  type Citation,
  type ConfirmTaskProposalResponse,
  type GroupDetails,
} from '@campusmeet/shared';
import { AIServiceError } from './service';
import { MeetingAIWorkspace } from './MeetingAIWorkspace';

const aiMocks = vi.hoisted(() => ({
  jobs: {} as Record<string, AIJobDetail>,
  minutesMutate: vi.fn(),
  minutesReset: vi.fn(),
  tasksMutate: vi.fn(),
  tasksReset: vi.fn(),
  confirmMutate: vi.fn(),
  confirmReset: vi.fn(),
  refetchJob: vi.fn(),
}));

type MutationOptions = { onSuccess?: (job: AIJob) => void };
type ConfirmationOptions = {
  onSuccess?: (response: ConfirmTaskProposalResponse) => void | Promise<void>;
  onError?: (error: Error) => void | Promise<void>;
};

const queuedJob = (aiJobId: string, type: AIJob['type'], meetingId = 'meeting-1'): AIJob => ({
  aiJobId,
  groupId: 'group-1',
  meetingId,
  type,
  status: 'QUEUED',
  attempt: 0,
  requestId: `request-${aiJobId}`,
  provider: 'BEDROCK',
  createdAt: '2026-08-03T00:00:00.000Z',
  updatedAt: '2026-08-03T00:00:00.000Z',
});

vi.mock('./hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./hooks')>();
  return {
    ...actual,
    useAIJob: (aiJobId?: string) => ({
      data: aiJobId ? aiMocks.jobs[aiJobId] : undefined,
      isLoading: false,
      isError: false,
      error: null,
      refetch: aiMocks.refetchJob,
    }),
    useMinutesDraftMutation: () => ({
      mutate: aiMocks.minutesMutate,
      reset: aiMocks.minutesReset,
      isPending: false,
      isError: false,
      error: null,
    }),
    useTaskProposalsMutation: () => ({
      mutate: aiMocks.tasksMutate,
      reset: aiMocks.tasksReset,
      isPending: false,
      isError: false,
      error: null,
    }),
    useConfirmTaskProposalMutation: () => ({
      mutate: aiMocks.confirmMutate,
      reset: aiMocks.confirmReset,
      isPending: false,
      isError: false,
      error: null,
    }),
  };
});

vi.mock('./service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./service')>();
  return { ...actual, createAIIdempotencyKey: () => 'key-test' };
});

const citation: Citation = {
  citationId: 'citation-1',
  groupId: 'group-1',
  meetingId: 'meeting-1',
  sourceType: 'TRANSCRIPT',
  sourceId: 'transcript-1',
  sourceVersion: 1,
  excerpt: 'Phạm vi demo được thống nhất.',
  internalUri: 'campusmeet://meetings/meeting-1/transcripts/transcript-1',
};

const group: GroupDetails = {
  group: {
    id: 'group-1',
    name: 'Nhóm A',
    role: GroupRole.GROUP_ADMIN,
    createdBy: 'admin',
    createdAt: '2026-08-01T00:00:00.000Z',
    joinedAt: '2026-08-01T00:00:00.000Z',
  },
  members: [
    {
      membership: {
        id: 'member-1',
        groupId: 'group-1',
        userId: 'user-1',
        role: GroupRole.MEMBER,
        active: true,
        joinedAt: '2026-08-01T00:00:00.000Z',
      },
      user: { id: 'user-1', displayName: 'Lan', email: 'lan@test.edu' },
    },
  ],
};

const confirmedResponse = (): ConfirmTaskProposalResponse => ({
  task: {
    id: 'task-authoritative',
    groupId: 'group-1',
    title: 'Hoàn thiện bản demo',
    assigneeId: 'user-1',
    status: 'TODO',
    priority: Priority.HIGH,
    sourceMeetingId: 'meeting-1',
    createdBy: 'admin',
    createdAt: '2026-08-08T01:00:00.000Z',
    updatedAt: '2026-08-08T01:00:00.000Z',
    version: 1,
  },
  proposal: {
    proposalId: 'proposal-1',
    groupId: 'group-1',
    meetingId: 'meeting-1',
    title: 'Hoàn thiện bản demo',
    assigneeId: 'user-1',
    priority: 'HIGH',
    missingFields: [],
    status: 'CONFIRMED',
    confirmedTaskId: 'task-authoritative',
    citations: [citation],
  },
});

const renderWorkspace = (details: GroupDetails = group) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidateQueries = vi.spyOn(client, 'invalidateQueries');
  return {
    ...render(
      <QueryClientProvider client={client}>
        <MeetingAIWorkspace meetingId="meeting-1" group={details} />
      </QueryClientProvider>,
    ),
    client,
    invalidateQueries,
  };
};

afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
  for (const aiJobId of Object.keys(aiMocks.jobs)) delete aiMocks.jobs[aiJobId];
  aiMocks.minutesMutate.mockImplementation((_input: unknown, options?: MutationOptions) => {
    options?.onSuccess?.(queuedJob('minutes-job', 'GENERATE_MINUTES'));
  });
  aiMocks.tasksMutate.mockImplementation((_input: unknown, options?: MutationOptions) => {
    options?.onSuccess?.(queuedJob('tasks-job', 'GENERATE_TASK_PROPOSALS'));
  });
  aiMocks.confirmMutate.mockImplementation((_input: unknown, options?: ConfirmationOptions) => {
    void options?.onSuccess?.(confirmedResponse());
  });
});

it('tạo và hiển thị biên bản nháp đúng meeting', async () => {
  aiMocks.jobs['minutes-job'] = {
    ...queuedJob('minutes-job', 'GENERATE_MINUTES'),
    status: 'COMPLETED',
    result: {
      meetingId: 'meeting-1',
      summary: 'Nhóm thống nhất phạm vi bản demo.',
      topics: [],
      decisions: [],
      actionItems: [],
      citations: [citation],
    },
  };

  renderWorkspace();
  fireEvent.click(screen.getByRole('button', { name: 'Tạo biên bản nháp' }));

  expect(aiMocks.minutesMutate).toHaveBeenCalledWith(
    { meetingId: 'meeting-1', request: {}, idempotencyKey: 'key-test' },
    expect.any(Object),
  );
  expect(await screen.findByText('Nhóm thống nhất phạm vi bản demo.')).toBeInTheDocument();
  expect(screen.getByText('Phạm vi demo được thống nhất.')).toBeInTheDocument();
});

it('xác nhận proposal bằng API và chỉ hiển thị task id từ response authoritative', async () => {
  aiMocks.jobs['tasks-job'] = {
    ...queuedJob('tasks-job', 'GENERATE_TASK_PROPOSALS'),
    status: 'COMPLETED',
    result: [
      {
        proposalId: 'proposal-1',
        groupId: 'group-1',
        meetingId: 'meeting-1',
        title: 'Hoàn thiện bản demo',
        missingFields: ['assigneeId', 'priority'],
        status: 'PENDING',
        citations: [citation],
      },
    ],
  };

  const { invalidateQueries } = renderWorkspace();
  fireEvent.click(screen.getByRole('button', { name: 'Đề xuất công việc' }));
  expect(await screen.findByText('Hoàn thiện bản demo')).toBeInTheDocument();
  const confirmButton = screen.getByRole('button', { name: 'Xác nhận tạo công việc' });
  expect(confirmButton).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Người phụ trách'), { target: { value: 'user-1' } });
  fireEvent.change(screen.getByLabelText('Mức ưu tiên'), { target: { value: 'HIGH' } });
  expect(screen.queryByText(/task-authoritative/)).not.toBeInTheDocument();
  fireEvent.click(confirmButton);

  expect(aiMocks.confirmMutate).toHaveBeenCalledWith(
    {
      proposalId: 'proposal-1',
      request: {
        title: 'Hoàn thiện bản demo',
        assigneeId: 'user-1',
        priority: Priority.HIGH,
      },
    },
    expect.any(Object),
  );
  expect(await screen.findByText('Đã tạo công việc task-authoritative.')).toBeInTheDocument();
  expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['tasks'] });
  expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['dashboard'] });
});

it('không hiển thị nút xác nhận cho MEMBER', async () => {
  aiMocks.jobs['tasks-job'] = {
    ...queuedJob('tasks-job', 'GENERATE_TASK_PROPOSALS'),
    status: 'COMPLETED',
    result: [
      {
        proposalId: 'proposal-1',
        groupId: 'group-1',
        meetingId: 'meeting-1',
        title: 'Hoàn thiện bản demo',
        assigneeId: 'user-1',
        priority: 'HIGH',
        missingFields: [],
        status: 'PENDING',
        citations: [citation],
      },
    ],
  };
  renderWorkspace({ ...group, group: { ...group.group, role: GroupRole.MEMBER } });
  fireEvent.click(screen.getByRole('button', { name: 'Đề xuất công việc' }));

  expect(await screen.findByText('Hoàn thiện bản demo')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Xác nhận tạo công việc' })).not.toBeInTheDocument();
});

it('giữ nội dung chỉnh sửa khi backend trả 422', async () => {
  aiMocks.jobs['tasks-job'] = {
    ...queuedJob('tasks-job', 'GENERATE_TASK_PROPOSALS'),
    status: 'COMPLETED',
    result: [
      {
        proposalId: 'proposal-1',
        groupId: 'group-1',
        meetingId: 'meeting-1',
        title: 'Hoàn thiện bản demo',
        assigneeId: 'user-1',
        priority: 'HIGH',
        missingFields: [],
        status: 'PENDING',
        citations: [citation],
      },
    ],
  };
  aiMocks.confirmMutate.mockImplementation((_input: unknown, options?: ConfirmationOptions) => {
    void options?.onError?.(
      new AIServiceError(422, 'VALIDATION_ERROR', 'Người phụ trách không còn hoạt động.'),
    );
  });
  renderWorkspace();
  fireEvent.click(screen.getByRole('button', { name: 'Đề xuất công việc' }));
  const title = await screen.findByLabelText('Tiêu đề công việc');
  fireEvent.change(title, { target: { value: 'Bản demo đã chỉnh sửa' } });
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận tạo công việc' }));

  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Người phụ trách không còn hoạt động.',
  );
  expect(title).toHaveValue('Bản demo đã chỉnh sửa');
});

it('refetch proposal job khi confirmation trả 409 mà không tạo task id giả', async () => {
  aiMocks.jobs['tasks-job'] = {
    ...queuedJob('tasks-job', 'GENERATE_TASK_PROPOSALS'),
    status: 'COMPLETED',
    result: [
      {
        proposalId: 'proposal-1',
        groupId: 'group-1',
        meetingId: 'meeting-1',
        title: 'Hoàn thiện bản demo',
        assigneeId: 'user-1',
        priority: 'HIGH',
        missingFields: [],
        status: 'PENDING',
        citations: [citation],
      },
    ],
  };
  aiMocks.confirmMutate.mockImplementation((_input: unknown, options?: ConfirmationOptions) => {
    void options?.onError?.(new AIServiceError(409, 'CONFLICT', 'Proposal đã thay đổi.'));
  });
  renderWorkspace();
  fireEvent.click(screen.getByRole('button', { name: 'Đề xuất công việc' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Xác nhận tạo công việc' }));

  await waitFor(() => expect(aiMocks.refetchJob).toHaveBeenCalledOnce());
  expect(screen.queryByText(/Đã tạo công việc/)).not.toBeInTheDocument();
});

it('từ chối hiển thị result thuộc meeting khác', async () => {
  aiMocks.jobs['minutes-job'] = {
    ...queuedJob('minutes-job', 'GENERATE_MINUTES'),
    status: 'COMPLETED',
    result: {
      meetingId: 'meeting-2',
      summary: 'Nội dung không thuộc meeting hiện tại.',
      topics: [],
      decisions: [],
      actionItems: [],
      citations: [citation],
    },
  };

  renderWorkspace();
  fireEvent.click(screen.getByRole('button', { name: 'Tạo biên bản nháp' }));

  expect(await screen.findByRole('alert')).toHaveTextContent('Không thể hoàn thành yêu cầu');
  expect(screen.queryByText('Nội dung không thuộc meeting hiện tại.')).not.toBeInTheDocument();
});

it('xóa output cũ khi đổi meeting', async () => {
  aiMocks.jobs['minutes-job'] = {
    ...queuedJob('minutes-job', 'GENERATE_MINUTES'),
    status: 'COMPLETED',
    result: {
      meetingId: 'meeting-1',
      summary: 'Nội dung chỉ thuộc cuộc họp đầu tiên.',
      topics: [],
      decisions: [],
      actionItems: [],
      citations: [citation],
    },
  };

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <MeetingAIWorkspace meetingId="meeting-1" group={group} />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Tạo biên bản nháp' }));
  expect(await screen.findByText('Nội dung chỉ thuộc cuộc họp đầu tiên.')).toBeInTheDocument();

  view.rerender(
    <QueryClientProvider client={client}>
      <MeetingAIWorkspace meetingId="meeting-2" group={group} />
    </QueryClientProvider>,
  );

  await waitFor(() =>
    expect(screen.queryByText('Nội dung chỉ thuộc cuộc họp đầu tiên.')).not.toBeInTheDocument(),
  );
  expect(aiMocks.minutesReset).toHaveBeenCalled();
  expect(aiMocks.tasksReset).toHaveBeenCalled();
});
