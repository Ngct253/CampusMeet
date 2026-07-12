// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LandingPage } from './LandingPage';

vi.mock('../auth/AuthProvider', () => ({ useAuth: () => ({ status: 'unauthenticated' }) }));

describe('LandingPage', () => {
  afterEach(cleanup);

  it('renders the durable hero message and real anchors', () => {
    render(<LandingPage />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Từ bàn họp đến hành động: Một mạch xuyên suốt.',
    );
    expect(screen.getByText(/CampusMeet kết nối nội dung cần bàn/)).toBeInTheDocument();
    expect(screen.getByText(/CampusMeet kết nối nội dung cần bàn/)).not.toHaveTextContent('nhóm');
    expect(document.querySelector('.landing-hero .landing-kicker')).toBeNull();
    expect(document.querySelector('.landing-thread-bridge')).toBeNull();
    expect(document.querySelector('.landing-page')?.textContent).not.toContain('\\n');
    document
      .querySelectorAll<HTMLAnchorElement>('.landing-page a[href^="#"]')
      .forEach((link) =>
        expect(document.querySelector(link.getAttribute('href')!)).toBeInTheDocument(),
      );
  });

  it('keeps the workflow, preview, and CTA claims focused', () => {
    render(<LandingPage />);
    const pageText = document.querySelector('.landing-page')?.textContent ?? '';
    ['Chuẩn bị nội dung', 'Chốt quyết định', 'Giao phần việc', 'Theo dõi tiến độ'].forEach(
      (title) => expect(pageText).toContain(title),
    );
    expect(pageText).toContain(
      'Minh họa giao diện CampusMeet. Nội dung mô phỏng luồng sử dụng, không phải dữ liệu thật.',
    );
    const workflowSection = document.querySelector('#quy-trinh');
    expect(workflowSection?.querySelectorAll('.landing-workflow__node')).toHaveLength(4);
    workflowSection
      ?.querySelectorAll('.landing-workflow__node')
      .forEach((node) => expect(node.textContent).toBe(''));
    expect(pageText).not.toMatch(/[\u2013\u2014]/);
    expect(pageText).not.toMatch(/đang phát triển|trong quá trình phát triển|scaffold|mock mode/i);
    expect(pageText).not.toContain('Google Calendar');
    expect(pageText).not.toContain('Google Meet');
    expect(
      screen.getByRole('heading', { name: 'Giữ phần tiếp nối của cuộc họp ở cùng một nơi.' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Cuộc họp kết thúc. Công việc tiếp tục.' }),
    ).toBeNull();
    expect(screen.queryByRole('link', { name: 'Xem lại giao diện' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Xem lại quy trình' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Lên đầu trang' })).toHaveAttribute(
      'href',
      '#dau-trang',
    );
    expect(
      document.querySelector('a[href="/sign-in"], a[href="/sign-up"], a[href^="/app/"]'),
    ).not.toBeNull();
  });
});
