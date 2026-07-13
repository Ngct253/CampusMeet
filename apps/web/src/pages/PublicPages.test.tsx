// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmSignUpPage, ForgotPasswordPage, SignInPage, SignUpPage } from './PublicPages';

const authMocks = vi.hoisted(() => ({
  signIn: vi.fn(),
  signUp: vi.fn(),
  confirmSignUp: vi.fn(),
  resendSignUpCode: vi.fn(),
  resetPassword: vi.fn(),
  confirmResetPassword: vi.fn(),
}));
const mockUseAuth = vi.hoisted(() => vi.fn());
vi.mock('aws-amplify/auth', () => authMocks);
vi.mock('../auth/AuthProvider', () => ({ useAuth: mockUseAuth }));

const user = {
  status: 'unauthenticated',
  user: null,
  error: null,
  refreshAuth: vi.fn(),
  signOut: vi.fn(),
};

function renderPage(page: React.ReactNode, path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={path} element={page} />
        <Route path={'/app/dashboard'} element={<p>Ứng dụng</p>} />
        <Route path={'/confirm-sign-up'} element={<p>Trang xác nhận</p>} />
        <Route path={'/sign-in'} element={path === '/sign-in' ? page : <p>Trang đăng nhập</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('direct Cognito auth pages', () => {
  beforeEach(() => {
    cleanup();
    vi.resetAllMocks();
    sessionStorage.clear();
    mockUseAuth.mockReturnValue(user);
  });

  it('sign-in gọi signIn và chuyển vào app', async () => {
    authMocks.signIn.mockResolvedValue({ isSignedIn: true, nextStep: { signInStep: 'DONE' } });
    renderPage(<SignInPage />, '/sign-in');
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: ' Lan@Example.EDU ' } });
    fireEvent.change(screen.getByLabelText('Mật khẩu'), { target: { value: 'Password123!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Đăng nhập' }));
    await waitFor(() =>
      expect(authMocks.signIn).toHaveBeenCalledWith({
        username: 'lan@example.edu',
        password: 'Password123!',
      }),
    );
    expect(await screen.findByText('Ứng dụng')).toBeInTheDocument();
  });

  it('toggle mật khẩu sign-in giữ giá trị và không submit', () => {
    renderPage(<SignInPage />, '/sign-in');
    const password = screen.getByLabelText('Mật khẩu');
    expect(password).toHaveAttribute('type', 'password');
    fireEvent.change(password, { target: { value: 'Password123!' } });
    const toggle = screen.getByRole('button', { name: 'Hiện mật khẩu' });
    expect(toggle).toHaveTextContent('');
    expect(toggle.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    fireEvent.click(toggle);
    expect(password).toHaveAttribute('type', 'text');
    expect(password).toHaveValue('Password123!');
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    const hide = screen.getByRole('button', { name: 'Ẩn mật khẩu' });
    expect(hide).toHaveAttribute('title', 'Ẩn mật khẩu');
    fireEvent.click(hide);
    expect(password).toHaveAttribute('type', 'password');
    expect(password).toHaveValue('Password123!');
    expect(authMocks.signIn).not.toHaveBeenCalled();
  });

  it('sign-up gọi signUp và chuyển tới xác nhận', async () => {
    authMocks.signUp.mockResolvedValue({
      isSignUpComplete: false,
      nextStep: { signUpStep: 'CONFIRM_SIGN_UP' },
    });
    renderPage(<SignUpPage />, '/sign-up');
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: ' Lan@Example.EDU ' } });
    screen
      .getAllByLabelText(/Mật khẩu|Xác nhận mật khẩu/)
      .forEach((input) => fireEvent.change(input, { target: { value: 'Password123!' } }));
    fireEvent.click(screen.getByRole('button', { name: 'Tạo tài khoản' }));
    await waitFor(() =>
      expect(authMocks.signUp).toHaveBeenCalledWith({
        username: 'lan@example.edu',
        password: 'Password123!',
        options: { userAttributes: { email: 'lan@example.edu' } },
      }),
    );
    expect(await screen.findByText('Trang xác nhận')).toBeInTheDocument();
    expect(sessionStorage.getItem('campusmeet:pendingEmail')).toBe('lan@example.edu');
  });

  it('hai mật khẩu sign-up toggle độc lập', () => {
    renderPage(<SignUpPage />, '/sign-up');
    const password = screen.getByLabelText('Mật khẩu');
    const confirmation = screen.getByLabelText('Xác nhận mật khẩu');
    expect(password).toHaveAttribute('type', 'password');
    expect(confirmation).toHaveAttribute('type', 'password');
    fireEvent.click(screen.getAllByRole('button', { name: 'Hiện mật khẩu' })[0]!);
    expect(password).toHaveAttribute('type', 'text');
    expect(confirmation).toHaveAttribute('type', 'password');
    fireEvent.click(screen.getByRole('button', { name: 'Ẩn mật khẩu' }));
    expect(password).toHaveAttribute('type', 'password');
  });

  it('confirm-sign-up gọi confirmSignUp', async () => {
    authMocks.confirmSignUp.mockResolvedValue({ isSignUpComplete: true });
    sessionStorage.setItem('campusmeet:pendingEmail', 'lan@example.edu');
    renderPage(<ConfirmSignUpPage />, '/confirm-sign-up');
    fireEvent.change(screen.getByLabelText('Mã xác nhận'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận' }));
    await waitFor(() =>
      expect(authMocks.confirmSignUp).toHaveBeenCalledWith({
        username: 'lan@example.edu',
        confirmationCode: '123456',
      }),
    );
  });

  it('forgot-password gửi mã rồi đặt mật khẩu mới', async () => {
    authMocks.resetPassword.mockResolvedValue({
      nextStep: { resetPasswordStep: 'CONFIRM_RESET_PASSWORD_WITH_CODE' },
    });
    authMocks.confirmResetPassword.mockResolvedValue(undefined);
    renderPage(<ForgotPasswordPage />, '/forgot-password');
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'lan@example.edu' } });
    fireEvent.click(screen.getByRole('button', { name: 'Gửi mã xác nhận' }));
    await screen.findByLabelText('Mã xác nhận');
    fireEvent.change(screen.getByLabelText('Mã xác nhận'), { target: { value: '123456' } });
    screen
      .getAllByLabelText(/Mật khẩu mới|Xác nhận mật khẩu mới/)
      .forEach((input) => fireEvent.change(input, { target: { value: 'NewPassword123!' } }));
    fireEvent.click(screen.getByRole('button', { name: 'Đặt mật khẩu mới' }));
    await waitFor(() => expect(authMocks.confirmResetPassword).toHaveBeenCalledOnce());
  });

  it('hai mật khẩu mới toggle độc lập', async () => {
    authMocks.resetPassword.mockResolvedValue({
      nextStep: { resetPasswordStep: 'CONFIRM_RESET_PASSWORD_WITH_CODE' },
    });
    renderPage(<ForgotPasswordPage />, '/forgot-password');
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'lan@example.edu' } });
    fireEvent.click(screen.getByRole('button', { name: 'Gửi mã xác nhận' }));
    const password = await screen.findByLabelText('Mật khẩu mới');
    const confirmation = screen.getByLabelText('Xác nhận mật khẩu mới');
    fireEvent.click(screen.getAllByRole('button', { name: 'Hiện mật khẩu' })[0]!);
    expect(password).toHaveAttribute('type', 'text');
    expect(confirmation).toHaveAttribute('type', 'password');
    fireEvent.click(screen.getByRole('button', { name: 'Ẩn mật khẩu' }));
    expect(password).toHaveAttribute('type', 'password');
  });

  it('thiếu cấu hình chỉ báo lỗi sau submit và không gọi Cognito', async () => {
    mockUseAuth.mockReturnValue({
      ...user,
      status: 'configuration-error',
      error: 'Chưa kết nối môi trường AWS. Form hiện chỉ dùng để kiểm tra giao diện.',
    });
    renderPage(<SignInPage />, '/sign-in');
    expect(
      screen.queryByText('Chưa kết nối môi trường AWS. Form hiện chỉ dùng để kiểm tra giao diện.'),
    ).toBeNull();
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'lan@example.edu' } });
    fireEvent.change(screen.getByLabelText('Mật khẩu'), { target: { value: 'Password123!' } });
    const button = screen.getByRole('button', { name: 'Đăng nhập' });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(
      await screen.findByText('Tính năng tài khoản hiện chưa khả dụng. Vui lòng thử lại sau.'),
    ).toBeInTheDocument();
    expect(authMocks.signIn).not.toHaveBeenCalled();
  });

  it('mọi trang auth vẫn hiển thị form khi thiếu cấu hình', () => {
    mockUseAuth.mockReturnValue({ ...user, status: 'configuration-error', error: 'hidden detail' });
    for (const [page, path, heading] of [
      [<SignUpPage />, '/sign-up', 'Tạo tài khoản'],
      [<ConfirmSignUpPage />, '/confirm-sign-up', 'Xác nhận tài khoản'],
      [<ForgotPasswordPage />, '/forgot-password', 'Quên mật khẩu'],
    ] as const) {
      const view = renderPage(page, path);
      expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument();
      expect(screen.queryByText('hidden detail')).toBeNull();
      view.unmount();
    }
  });

  it('sign-up báo mật khẩu xác nhận không khớp và không gọi Cognito', async () => {
    renderPage(<SignUpPage />, '/sign-up');
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'lan@example.edu' } });
    fireEvent.change(screen.getByLabelText('Mật khẩu'), { target: { value: 'Password123!' } });
    fireEvent.change(screen.getByLabelText('Xác nhận mật khẩu'), {
      target: { value: 'Different123!' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Tạo tài khoản' }));
    expect(await screen.findByText('Mật khẩu xác nhận không khớp.')).toBeInTheDocument();
    expect(screen.getByLabelText('Xác nhận mật khẩu')).toHaveAttribute('aria-invalid', 'true');
    expect(authMocks.signUp).not.toHaveBeenCalled();
  });

  it('sign-up email sai định dạng không gọi Cognito', async () => {
    renderPage(<SignUpPage />, '/sign-up');
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'not-an-email' } });
    screen
      .getAllByLabelText(/Mật khẩu|Xác nhận mật khẩu/)
      .forEach((input) => fireEvent.change(input, { target: { value: 'Password123!' } }));
    fireEvent.click(screen.getByRole('button', { name: 'Tạo tài khoản' }));
    expect(await screen.findByText('Email không hợp lệ.')).toBeInTheDocument();
    expect(authMocks.signUp).not.toHaveBeenCalled();
  });

  it('sign-up hiển thị UsernameExistsException tại field email', async () => {
    authMocks.signUp.mockRejectedValue(
      Object.assign(new Error('raw AWS account detail'), { name: 'UsernameExistsException' }),
    );
    renderPage(<SignUpPage />, '/sign-up');
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'lan@example.edu' } });
    screen
      .getAllByLabelText(/Mật khẩu|Xác nhận mật khẩu/)
      .forEach((input) => fireEvent.change(input, { target: { value: 'Password123!' } }));
    fireEvent.click(screen.getByRole('button', { name: 'Tạo tài khoản' }));
    expect(await screen.findByText('Email đã được đăng ký.')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.queryByText(/raw AWS account detail/)).toBeNull();
  });

  it('UserNotConfirmedException chuyển người dùng tới xác nhận tài khoản', async () => {
    authMocks.signIn.mockRejectedValue(
      Object.assign(new Error('raw'), { name: 'UserNotConfirmedException' }),
    );
    renderPage(<SignInPage />, '/sign-in');
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'lan@example.edu' } });
    fireEvent.change(screen.getByLabelText('Mật khẩu'), { target: { value: 'Password123!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Đăng nhập' }));
    expect(await screen.findByText('Trang xác nhận')).toBeInTheDocument();
    expect(sessionStorage.getItem('campusmeet:pendingEmail')).toBe('lan@example.edu');
  });

  it('CodeMismatchException hiển thị cạnh mã xác nhận', async () => {
    authMocks.confirmSignUp.mockRejectedValue(
      Object.assign(new Error('raw AWS code detail'), { name: 'CodeMismatchException' }),
    );
    sessionStorage.setItem('campusmeet:pendingEmail', 'lan@example.edu');
    renderPage(<ConfirmSignUpPage />, '/confirm-sign-up');
    fireEvent.change(screen.getByLabelText('Mã xác nhận'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận' }));
    expect(await screen.findByText('Mã xác nhận không đúng.')).toBeInTheDocument();
    expect(screen.getByLabelText('Mã xác nhận')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.queryByText(/raw AWS code detail/)).toBeNull();
  });

  it('mã xác nhận sai định dạng không gọi Cognito', async () => {
    sessionStorage.setItem('campusmeet:pendingEmail', 'lan@example.edu');
    renderPage(<ConfirmSignUpPage />, '/confirm-sign-up');
    fireEvent.change(screen.getByLabelText('Mã xác nhận'), { target: { value: '12A456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận' }));
    expect(await screen.findByText('Mã xác nhận gồm 6 chữ số.')).toBeInTheDocument();
    expect(authMocks.confirmSignUp).not.toHaveBeenCalled();
  });

  it('forgot-password không tiết lộ UserNotFoundException', async () => {
    authMocks.resetPassword.mockRejectedValue(
      Object.assign(new Error('raw user lookup detail'), { name: 'UserNotFoundException' }),
    );
    renderPage(<ForgotPasswordPage />, '/forgot-password');
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'unknown@example.edu' } });
    fireEvent.click(screen.getByRole('button', { name: 'Gửi mã xác nhận' }));
    expect(
      await screen.findByText(
        'Nếu tài khoản tồn tại, hướng dẫn khôi phục mật khẩu sẽ được gửi đến email.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Mã xác nhận')).toBeInTheDocument();
    expect(screen.queryByText(/raw user lookup detail/)).toBeNull();
  });

  it('lỗi Cognito không xác định chỉ hiển thị fallback', async () => {
    authMocks.signIn.mockRejectedValue(
      Object.assign(new Error('raw AWS stack trace'), { name: 'UnknownException' }),
    );
    renderPage(<SignInPage />, '/sign-in');
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'lan@example.edu' } });
    fireEvent.change(screen.getByLabelText('Mật khẩu'), { target: { value: 'Password123!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Đăng nhập' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Không thể hoàn tất yêu cầu. Vui lòng thử lại.',
    );
    expect(screen.queryByText(/raw AWS stack trace/)).toBeNull();
  });
});
