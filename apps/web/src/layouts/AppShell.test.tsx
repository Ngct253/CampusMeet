// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GroundedAnswer } from '@campusmeet/shared';
import { AppShell } from './AppShell';

vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({
    status: 'authenticated',
    user: { username: 'lan', userId: 'user-1' },
    signOut: vi.fn(),
    error: null,
  }),
}));

const mockMeetingMutate = vi.fn();
const mockGroupMutate = vi.fn();
const mockMeetingReset = vi.fn();
const mockGroupReset = vi.fn();

type ChatSubmitInput = {
  question: string;
  intent: 'QUESTION_ANSWER' | 'LATE_JOIN_SUMMARY';
};

const answer: GroundedAnswer = {
  answer: 'Câu trả lời có căn cứ',
  citations: [],
  scope: 'CURRENT_MEETING',
  insufficientContext: true,
};

vi.mock('../features/ai', () => ({
  AIChatPanel: ({
    answer: groundedAnswer,
    context,
    onSubmit,
  }: {
    answer?: GroundedAnswer;
    context?: 'meeting' | 'group';
    onSubmit: (value: ChatSubmitInput) => void;
  }) => (
    <div data-context={context} data-testid="ai-chat-panel">
      AI Chat
      {groundedAnswer?.answer}
      <button onClick={() => onSubmit({ question: 'test question', intent: 'QUESTION_ANSWER' })}>
        Submit Mock
      </button>
    </div>
  ),
  AIJobState: () => <div data-testid="ai-job-state">Job State</div>,
  createAIIdempotencyKey: () => 'key-test',
  useAIJob: () => ({
    data: { status: 'COMPLETED', result: answer },
    isLoading: false,
    isError: false,
  }),
  useMeetingChatMutation: () => ({
    mutate: mockMeetingMutate,
    reset: mockMeetingReset,
    isPending: false,
    isError: false,
  }),
  useGroupSearchMutation: () => ({
    mutate: mockGroupMutate,
    reset: mockGroupReset,
    isPending: false,
    isError: false,
  }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('AppShell', () => {
  function renderShell(initialPath = '/app/dashboard') {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[initialPath]}>
          <Routes>
            <Route path="/app" element={<AppShell />}>
              <Route path="dashboard" element={<p>Dashboard</p>} />
              <Route path="groups/:groupId" element={<p>Group</p>} />
              <Route path="meetings/:meetingId" element={<p>Meeting</p>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  it('renders authenticated navigation without a simulation banner', () => {
    renderShell();
    expect(screen.getByText('Không gian cá nhân')).toBeInTheDocument();
    expect(screen.queryByText(/mô phỏng/i)).not.toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Điều hướng chính' })).toBeInTheDocument();
  });

  it('nút Trợ lý AI hiện và click mở panel thành công', async () => {
    renderShell();
    const toggleBtn = screen.getByRole('button', { name: /Trợ lý AI/i });
    expect(toggleBtn).toBeInTheDocument();
    fireEvent.click(toggleBtn);
    expect(screen.getByText('Trợ lý điều phối')).toBeInTheDocument();
    expect(screen.getByText('Chưa chọn không gian làm việc')).toBeInTheDocument();
  });

  it('chuyển đổi context đúng khi ở các trang có params', async () => {
    const { unmount } = renderShell('/app/meetings/meeting-1');
    let toggleBtn = screen.getByRole('button', { name: /Trợ lý AI/i });
    fireEvent.click(toggleBtn);

    expect(screen.getByTestId('ai-chat-panel')).toHaveAttribute('data-context', 'meeting');
    expect(screen.getByTestId('ai-chat-panel')).toHaveTextContent(answer.answer);
    fireEvent.click(screen.getByText('Submit Mock'));
    expect(mockMeetingMutate).toHaveBeenCalledWith(
      {
        meetingId: 'meeting-1',
        request: { question: 'test question', intent: 'QUESTION_ANSWER' },
        idempotencyKey: 'key-test',
      },
      expect.any(Object),
    );
    unmount();

    renderShell('/app/groups/group-1');
    toggleBtn = screen.getByRole('button', { name: /Trợ lý AI/i });
    fireEvent.click(toggleBtn);

    expect(screen.getByTestId('ai-chat-panel')).toHaveAttribute('data-context', 'group');
    fireEvent.click(screen.getByText('Submit Mock'));
    expect(mockGroupMutate).toHaveBeenCalledWith(
      {
        groupId: 'group-1',
        request: { question: 'test question', scope: 'WHOLE_GROUP' },
        idempotencyKey: 'key-test',
      },
      expect.any(Object),
    );
  });
});
