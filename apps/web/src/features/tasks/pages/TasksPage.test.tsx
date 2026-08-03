// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TasksPage } from './TasksPage';

const getTasks = vi.hoisted(() => vi.fn());
vi.mock('../service', () => ({ getTasks }));

const renderPage = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TasksPage />
    </QueryClientProvider>,
  );
};

describe('TasksPage', () => {
  afterEach(() => {
    cleanup();
    getTasks.mockReset();
  });

  it('shows loading state', () => {
    getTasks.mockReturnValue(new Promise(() => undefined));
    renderPage();
    expect(screen.getByRole('status')).toHaveTextContent('Đang tải công việc');
  });

  it('shows error state', async () => {
    getTasks.mockRejectedValue(new Error('network'));
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('Chưa thể tải công việc');
    expect(screen.queryByText('network')).not.toBeInTheDocument();
  });

  it('shows empty state', async () => {
    getTasks.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText('Chưa có công việc được giao')).toBeInTheDocument();
  });

  it('shows assigned tasks', async () => {
    getTasks.mockResolvedValue([
      {
        id: 'task-1',
        groupId: 'group-1',
        title: 'Hoàn thiện báo cáo',
        assigneeId: 'user-1',
        status: 'TODO',
        priority: 'HIGH',
      },
    ]);
    renderPage();
    expect(await screen.findByText('Hoàn thiện báo cáo')).toBeInTheDocument();
    expect(screen.getByText('TODO')).toBeInTheDocument();
    expect(screen.getByText('Ưu tiên: HIGH')).toBeInTheDocument();
  });
});
