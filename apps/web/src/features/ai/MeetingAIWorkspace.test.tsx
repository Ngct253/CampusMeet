// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  GroupRole,
  Priority,
  TaskStatus,
  type AIJob,
  type AIJobDetail,
  type Citation,
  type ConfirmTaskProposalResponse,
  type GroupDetails,
} from '@campusmeet/shared';
import { MeetingAIWorkspace } from './MeetingAIWorkspace';

const aiMocks = vi.hoisted(() => ({
  jobs: {} as Record<string, AIJobDetail>,
  minutesMutate: vi.fn(),
  minutesReset: vi.fn(),
  tasksMutate: vi.fn(),
  tasksReset: vi.fn(),
  confirmMutate: vi.fn(),
  confirmReset: vi.fn(),
}));

type MutationOptions<T> = { onSuccess?: (result: T) => void };

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
  return {
    ...actual,
    createAIIdempotencyKey: () => 'key-test',
    taskProposalConfirmationKey: (proposalId: string) => `confirm-${proposalId}`,
  };
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

afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
  for (const aiJobId of Object.keys(aiMocks.jobs)) delete aiMocks.jobs[aiJobId];
  aiMocks.minutesMutate.mockImplementation((_input: unknown, options?: MutationOptions<AIJob>) => {
    options?.onSuccess?.(queuedJob('minutes-job', 'GENERATE_MINUTES'));
  });
  aiMocks.tasksMutate.mockImplementation((_input: unknown, options?: MutationOptions<AIJob>) => {
    options?.onSuccess?.(queuedJob('tasks-job', 'GENERATE_TASK_PROPOSALS'));
  });
  aiMocks.confirmMutate.mockImplementation(
    (_input: unknown, options?: MutationOptions<ConfirmTaskProposalResponse>) => {
      options?.onSuccess?.({
        proposal: {
          proposalId: 'proposal-1',
          groupId: 'group-1',
          meetingId: 'meeting-1',
          title: 'Hoàn thiện bản demo',
          assigneeId: 'user-1',
          priority: Priority.HIGH,
          missingFields: [],
          status: 'EXECUTED',
          taskId: 'task-1',
          citations: [citation],
        },
        task: {
          id: 'task-1',
          groupId: 'group-1',
          title: 'Hoàn thiện bản demo',
          assigneeId: 'user-1',
          priority: Priority.HIGH,
          status: TaskStatus.TODO,
          sourceMeetingId: 'meeting-1',
        },
      });
    },
  );
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

  render(<MeetingAIWorkspace meetingId="meeting-1" group={group} />);
  fireEvent.click(screen.getByRole('button', { name: 'Tạo biên bản nháp' }));

  expect(aiMocks.minutesMutate).toHaveBeenCalledWith(
    { meetingId: 'meeting-1', request: {}, idempotencyKey: 'key-test' },
    expect.any(Object),
  );
  expect(await screen.findByText('Nhóm thống nhất phạm vi bản demo.')).toBeInTheDocument();
  expect(screen.getByText('Phạm vi demo được thống nhất.')).toBeInTheDocument();
});

it('xác nhận TaskProposal qua backend và hiển thị Task đã tạo', async () => {
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

  render(<MeetingAIWorkspace meetingId="meeting-1" group={group} />);
  fireEvent.click(screen.getByRole('button', { name: 'Đề xuất công việc' }));
  expect(await screen.findByText('Hoàn thiện bản demo')).toBeInTheDocument();
  const completeButton = screen.getByRole('button', { name: 'Xác nhận tạo công việc' });
  expect(completeButton).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Người phụ trách'), { target: { value: 'user-1' } });
  fireEvent.change(screen.getByLabelText('Mức ưu tiên'), { target: { value: 'HIGH' } });
  fireEvent.click(completeButton);

  expect(aiMocks.confirmMutate).toHaveBeenCalledWith(
    {
      proposalId: 'proposal-1',
      request: { assigneeId: 'user-1', priority: 'HIGH' },
      idempotencyKey: 'confirm-proposal-1',
    },
    expect.any(Object),
  );
  expect(screen.getByText('Công việc đã được tạo thành công.')).toBeInTheDocument();
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

  render(<MeetingAIWorkspace meetingId="meeting-1" group={group} />);
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

  const view = render(<MeetingAIWorkspace meetingId="meeting-1" group={group} />);
  fireEvent.click(screen.getByRole('button', { name: 'Tạo biên bản nháp' }));
  expect(await screen.findByText('Nội dung chỉ thuộc cuộc họp đầu tiên.')).toBeInTheDocument();

  view.rerender(<MeetingAIWorkspace meetingId="meeting-2" group={group} />);

  await waitFor(() =>
    expect(screen.queryByText('Nội dung chỉ thuộc cuộc họp đầu tiên.')).not.toBeInTheDocument(),
  );
  expect(aiMocks.minutesReset).toHaveBeenCalled();
  expect(aiMocks.tasksReset).toHaveBeenCalled();
});
