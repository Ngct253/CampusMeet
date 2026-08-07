// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AIJob, AIJobDetail, KnowledgeScope } from '@campusmeet/shared';
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

const meetingServices = vi.hoisted(() => ({ getAllMeetings: vi.fn().mockResolvedValue([]) }));
vi.mock('../../meetings/service', () => meetingServices);

vi.mock('../../../auth/AuthProvider', () => ({
  useAuth: () => ({ status: 'authenticated', user: { userId: 'user-1' } }),
}));

const aiMocks = vi.hoisted(() => ({
  jobs: {} as Record<string, AIJobDetail>,
  searchMutate: vi.fn(),
  searchReset: vi.fn(),
  progressMutate: vi.fn(),
  progressReset: vi.fn(),
}));

type SearchInput = {
  question: string;
  scope: KnowledgeScope;
  meetingIds?: string[];
};

type MutationOptions = { onSuccess?: (job: AIJob) => void };

const queuedJob = (aiJobId: string, type: AIJob['type']): AIJob => ({
  aiJobId,
  groupId: 'group-1',
  type,
  status: 'QUEUED',
  attempt: 0,
  requestId: `request-${aiJobId}`,
  provider: 'BEDROCK',
  createdAt: '2026-08-03T00:00:00.000Z',
  updatedAt: '2026-08-03T00:00:00.000Z',
});

vi.mock('../../ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../ai')>();
  return {
    ...actual,
    GroupSearchPanel: ({ onSearch }: { onSearch: (input: SearchInput) => void }) => (
      <button
        data-testid="group-search-panel"
        type="button"
        onClick={() => onSearch({ question: 'Nhóm đã quyết định gì?', scope: 'WHOLE_GROUP' })}
      >
        Tìm trong tài liệu của nhóm
      </button>
    ),
    createAIIdempotencyKey: () => 'key-test',
    useAIJob: (aiJobId?: string) => ({
      data: aiJobId ? aiMocks.jobs[aiJobId] : undefined,
      isLoading: false,
      isError: false,
      error: null,
    }),
    useGroupSearchMutation: () => ({
      mutate: aiMocks.searchMutate,
      reset: aiMocks.searchReset,
      isPending: false,
      isError: false,
      error: null,
    }),
    useProgressAnalysisMutation: () => ({
      mutate: aiMocks.progressMutate,
      reset: aiMocks.progressReset,
      isPending: false,
      isError: false,
      error: null,
    }),
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  for (const aiJobId of Object.keys(aiMocks.jobs)) delete aiMocks.jobs[aiJobId];
  aiMocks.searchMutate.mockImplementation((_input: unknown, options?: MutationOptions) => {
    options?.onSuccess?.(queuedJob('search-job', 'GENERATE_ANSWER'));
  });
  aiMocks.progressMutate.mockImplementation((_input: unknown, options?: MutationOptions) => {
    options?.onSuccess?.(queuedJob('progress-job', 'PROGRESS_ANALYSIS'));
  });
});

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
          <Route
            path="/app/groups/:groupId"
            element={
              <>
                <GroupDetailPage />
                <Link to="/app/groups/group-2">Nhóm kế tiếp</Link>
              </>
            }
          />
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
  expect(screen.queryByText('Chưa có phân tích tiến độ')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Chạy phân tích tiến độ' })).not.toBeInTheDocument();
});

it('ProgressAnalysisPanel hiển thị với admin', async () => {
  renderGroupDetail('GROUP_ADMIN');
  expect(await screen.findByText('Chưa có phân tích tiến độ')).toBeInTheDocument();
});

it('hiển thị câu trả lời và citation khi Group Search hoàn tất', async () => {
  aiMocks.jobs['search-job'] = {
    ...queuedJob('search-job', 'GENERATE_ANSWER'),
    status: 'COMPLETED',
    result: {
      answer: 'Nhóm đã thống nhất phát hành bản thử nghiệm.',
      scope: 'WHOLE_GROUP',
      insufficientContext: false,
      citations: [
        {
          citationId: 'citation-1',
          groupId: 'group-1',
          meetingId: 'meeting-1',
          sourceType: 'TRANSCRIPT',
          sourceId: 'transcript-1',
          sourceVersion: 1,
          excerpt: 'Phát hành bản thử nghiệm vào cuối tuần.',
          internalUri: 'campusmeet://groups/group-1/meetings/meeting-1/transcripts/transcript-1',
        },
      ],
    },
  };

  renderGroupDetail('MEMBER');
  fireEvent.click(await screen.findByTestId('group-search-panel'));

  expect(
    await screen.findByText('Nhóm đã thống nhất phát hành bản thử nghiệm.'),
  ).toBeInTheDocument();
  expect(screen.getByText('Phát hành bản thử nghiệm vào cuối tuần.')).toBeInTheDocument();
});

it('hiển thị kết quả Progress Analysis cho Group Admin', async () => {
  aiMocks.jobs['progress-job'] = {
    ...queuedJob('progress-job', 'PROGRESS_ANALYSIS'),
    status: 'COMPLETED',
    result: {
      groupId: 'group-1',
      summary: 'Nhóm đã hoàn thành phần lớn công việc trong sprint.',
      observations: ['Ba công việc đã hoàn thành.'],
      risks: ['Một công việc đã quá hạn.'],
      generatedAt: '2026-08-03T00:05:00.000Z',
    },
  };

  renderGroupDetail('GROUP_ADMIN');
  fireEvent.click(await screen.findByRole('button', { name: 'Chạy phân tích tiến độ' }));

  expect(
    await screen.findByText('Nhóm đã hoàn thành phần lớn công việc trong sprint.'),
  ).toBeInTheDocument();
  expect(screen.getByText('Một công việc đã quá hạn.')).toBeInTheDocument();
});

it('hiển thị lỗi thay vì output khi result không khớp loại job', async () => {
  aiMocks.jobs['search-job'] = {
    ...queuedJob('search-job', 'GENERATE_ANSWER'),
    status: 'COMPLETED',
    result: {
      groupId: 'group-1',
      summary: 'Output sai loại.',
      observations: [],
      risks: [],
      generatedAt: '2026-08-03T00:05:00.000Z',
    },
  };

  renderGroupDetail('MEMBER');
  fireEvent.click(await screen.findByTestId('group-search-panel'));

  expect(await screen.findByRole('alert')).toHaveTextContent('Không thể hoàn thành yêu cầu');
  expect(screen.queryByText('Output sai loại.')).not.toBeInTheDocument();
});

it('xóa output AI cũ khi chuyển sang group khác', async () => {
  aiMocks.jobs['search-job'] = {
    ...queuedJob('search-job', 'GENERATE_ANSWER'),
    status: 'COMPLETED',
    result: {
      answer: 'Nội dung chỉ thuộc nhóm đầu tiên.',
      scope: 'WHOLE_GROUP',
      insufficientContext: false,
      citations: [],
    },
  };

  renderGroupDetail('MEMBER');
  fireEvent.click(await screen.findByTestId('group-search-panel'));
  expect(await screen.findByText('Nội dung chỉ thuộc nhóm đầu tiên.')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('link', { name: 'Nhóm kế tiếp' }));

  expect(screen.queryByText('Nội dung chỉ thuộc nhóm đầu tiên.')).not.toBeInTheDocument();
  expect(aiMocks.searchReset).toHaveBeenCalled();
  expect(aiMocks.progressReset).toHaveBeenCalled();
});
