import {
  confirmResetPassword,
  confirmSignUp,
  resendSignUpCode,
  resetPassword,
  signIn,
  signUp,
} from 'aws-amplify/auth';
import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';

const pendingEmailKey = 'campusmeet:pendingEmail';
const accountUnavailableMessage = 'Tính năng tài khoản hiện chưa khả dụng. Vui lòng thử lại sau.';

function destination() {
  const saved = sessionStorage.getItem('campusmeet:returnTo');
  sessionStorage.removeItem('campusmeet:returnTo');
  return saved === '/app' || saved?.startsWith('/app/') ? saved : '/app/dashboard';
}

const normalizeEmail = (email: string) => email.trim().toLowerCase();

function message(error: unknown) {
  const name = error instanceof Error ? error.name : '';
  if (name === 'UserNotConfirmedException') return 'Tài khoản chưa được xác nhận.';
  if (name === 'NotAuthorizedException') return 'Email hoặc mật khẩu không đúng.';
  if (name === 'UsernameExistsException') return 'Email này đã có tài khoản.';
  if (name === 'CodeMismatchException') return 'Mã xác nhận không đúng.';
  if (name === 'ExpiredCodeException') return 'Mã xác nhận đã hết hạn. Vui lòng gửi mã mới.';
  if (name === 'LimitExceededException') return 'Bạn đã thử quá nhiều lần. Vui lòng chờ rồi thử lại.';
  return 'Không thể hoàn tất yêu cầu. Vui lòng thử lại.';
}

function AuthPage({ title, children }: { title: string; children: ReactNode }) {
  return <main className={'auth-page'}>
    <section className={'auth-panel'} aria-labelledby={'auth-title'}>
      <Link className={'brand auth-brand'} to={'/'}>CampusMeet</Link>
      <h1 id={'auth-title'}>{title}</h1>
      {children}
    </section>
  </main>;
}

function Field({ label, name, type = 'text', autoComplete, value, onChange }: {
  label: string;
  name: string;
  type?: string;
  autoComplete: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return <label className={'auth-field'} htmlFor={name}>
    <span>{label}</span>
    <input id={name} name={name} type={type} autoComplete={autoComplete} value={value}
      onChange={(event) => onChange(event.target.value)} required />
  </label>;
}

function PasswordVisibilityIcon({ visible }: { visible: boolean }) {
  return <svg viewBox={'0 0 24 24'} width={'20'} height={'20'} fill={'none'}
    stroke={'currentColor'} strokeWidth={'1.8'} strokeLinecap={'round'} strokeLinejoin={'round'}
    aria-hidden={'true'}>
    <path d={'M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z'} />
    <circle cx={'12'} cy={'12'} r={'2.75'} />
    {visible && <path d={'m4 4 16 16'} />}
  </svg>;
}

function PasswordField({ label, name, autoComplete, value, onChange }: {
  label: string;
  name: string;
  autoComplete: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const [visible, setVisible] = useState(false);
  const action = visible ? 'Ẩn mật khẩu' : 'Hiện mật khẩu';
  return <div className={'auth-field'}>
    <label htmlFor={name}>{label}</label>
    <div className={'password-control'}>
      <input id={name} name={name} type={visible ? 'text' : 'password'} autoComplete={autoComplete}
        value={value} onChange={(event) => onChange(event.target.value)} required />
      <button type={'button'} aria-label={action} title={action} aria-pressed={visible}
        onClick={() => setVisible((current) => !current)}>
        <PasswordVisibilityIcon visible={visible} />
      </button>
    </div>
  </div>;
}

function ErrorMessage({ error, errorRef }: { error: string; errorRef: React.RefObject<HTMLParagraphElement | null> }) {
  return error ? <p className={'auth-error'} ref={errorRef} tabIndex={-1} aria-live={'polite'}>{error}</p> : null;
}

function useFormError() {
  const [error, setError] = useState('');
  const errorRef = useRef<HTMLParagraphElement>(null);
  const showError = (value: string) => {
    setError(value);
    requestAnimationFrame(() => errorRef.current?.focus());
  };
  return { error, errorRef, showError, clearError: () => setError('') };
}

function AuthenticatedRedirect() {
  return <Navigate to={'/app/dashboard'} replace />;
}

export function SignInPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const { error, errorRef, showError, clearError } = useFormError();
  if (auth.status === 'authenticated') return <AuthenticatedRedirect />;
  const configured = auth.status !== 'configuration-error';

  async function submit(event: FormEvent) {
    event.preventDefault();
    clearError();
    const username = normalizeEmail(email);
    if (!username || !password) return showError('Vui lòng nhập email và mật khẩu.');
    if (!configured) return showError(accountUnavailableMessage);
    setSubmitting(true);
    try {
      const result = await signIn({ username, password });
      if (result.nextStep.signInStep === 'CONFIRM_SIGN_UP') {
        sessionStorage.setItem(pendingEmailKey, username);
        navigate('/confirm-sign-up');
        return;
      }
      if (!result.isSignedIn) return showError('Tài khoản cần thêm một bước xác thực chưa được hỗ trợ.');
      await auth.refreshAuth();
      navigate(destination(), { replace: true });
    } catch (cause) {
      if (cause instanceof Error && cause.name === 'UserNotConfirmedException') {
        sessionStorage.setItem(pendingEmailKey, username);
        navigate('/confirm-sign-up');
      } else showError(message(cause));
    } finally {
      setSubmitting(false);
    }
  }

  return <AuthPage title={'Đăng nhập'}>
    {location.state?.message && <p className={'auth-success'} aria-live={'polite'}>{location.state.message}</p>}
    <form className={'auth-form'} onSubmit={(event) => void submit(event)} noValidate>
      <Field label={'Email'} name={'sign-in-email'} type={'email'} autoComplete={'email'} value={email} onChange={setEmail} />
      <PasswordField label={'Mật khẩu'} name={'sign-in-password'} autoComplete={'current-password'} value={password} onChange={setPassword} />
      <ErrorMessage error={error} errorRef={errorRef} />
      <button type={'submit'} disabled={submitting || !email.trim() || !password}>{submitting ? 'Đang đăng nhập...' : 'Đăng nhập'}</button>
    </form>
    <div className={'auth-links'}><Link to={'/forgot-password'}>Quên mật khẩu</Link><Link to={'/sign-up'}>Tạo tài khoản</Link></div>
  </AuthPage>;
}

export function SignUpPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const { error, errorRef, showError, clearError } = useFormError();
  if (auth.status === 'authenticated') return <AuthenticatedRedirect />;
  const configured = auth.status !== 'configuration-error';

  async function submit(event: FormEvent) {
    event.preventDefault();
    clearError();
    const username = normalizeEmail(email);
    if (!username || !password || !confirmation) return showError('Vui lòng nhập đầy đủ thông tin.');
    if (password !== confirmation) return showError('Mật khẩu xác nhận không khớp.');
    if (!configured) return showError(accountUnavailableMessage);
    setSubmitting(true);
    try {
      const result = await signUp({ username, password, options: { userAttributes: { email: username } } });
      if (result.isSignUpComplete) {
        navigate('/sign-in', { replace: true, state: { message: 'Tài khoản đã được tạo. Bạn có thể đăng nhập.' } });
      } else if (result.nextStep.signUpStep === 'CONFIRM_SIGN_UP') {
        sessionStorage.setItem(pendingEmailKey, username);
        navigate('/confirm-sign-up');
      } else {
        showError('Tài khoản cần thêm một bước xác thực chưa được hỗ trợ.');
      }
    } catch (cause) {
      showError(message(cause));
    } finally {
      setSubmitting(false);
    }
  }

  return <AuthPage title={'Tạo tài khoản'}>
    <form className={'auth-form'} onSubmit={(event) => void submit(event)} noValidate>
      <Field label={'Email'} name={'sign-up-email'} type={'email'} autoComplete={'email'} value={email} onChange={setEmail} />
      <PasswordField label={'Mật khẩu'} name={'sign-up-password'} autoComplete={'new-password'} value={password} onChange={setPassword} />
      <PasswordField label={'Xác nhận mật khẩu'} name={'sign-up-confirmation'} autoComplete={'new-password'} value={confirmation} onChange={setConfirmation} />
      <ErrorMessage error={error} errorRef={errorRef} />
      <button type={'submit'} disabled={submitting || !email.trim() || !password || !confirmation || password !== confirmation}>{submitting ? 'Đang tạo tài khoản...' : 'Tạo tài khoản'}</button>
    </form>
    <p className={'auth-links'}>Đã có tài khoản? <Link to={'/sign-in'}>Đăng nhập</Link></p>
  </AuthPage>;
}

export function ConfirmSignUpPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState(() => sessionStorage.getItem(pendingEmailKey) ?? '');
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState('');
  const { error, errorRef, showError, clearError } = useFormError();
  if (auth.status === 'authenticated') return <AuthenticatedRedirect />;
  const configured = auth.status !== 'configuration-error';

  async function submit(event: FormEvent) {
    event.preventDefault();
    clearError();
    const username = normalizeEmail(email);
    if (!username || !code.trim()) return showError('Vui lòng nhập email và mã xác nhận.');
    if (!configured) return showError(accountUnavailableMessage);
    setSubmitting(true);
    try {
      await confirmSignUp({ username, confirmationCode: code.trim() });
      sessionStorage.removeItem(pendingEmailKey);
      navigate('/sign-in', { replace: true, state: { message: 'Tài khoản đã được xác nhận. Bạn có thể đăng nhập.' } });
    } catch (cause) {
      showError(message(cause));
    } finally {
      setSubmitting(false);
    }
  }

  async function resend() {
    clearError();
    const username = normalizeEmail(email);
    if (!username) return showError('Vui lòng nhập email trước khi gửi lại mã.');
    if (!configured) return showError(accountUnavailableMessage);
    setSubmitting(true);
    try {
      await resendSignUpCode({ username });
      setNotice('Mã xác nhận mới đã được gửi tới email của bạn.');
    } catch (cause) {
      showError(message(cause));
    } finally {
      setSubmitting(false);
    }
  }

  return <AuthPage title={'Xác nhận tài khoản'}>
    {notice && <p className={'auth-success'} aria-live={'polite'}>{notice}</p>}
    <form className={'auth-form'} onSubmit={(event) => void submit(event)} noValidate>
      <Field label={'Email'} name={'confirm-email'} type={'email'} autoComplete={'email'} value={email} onChange={setEmail} />
      <Field label={'Mã xác nhận'} name={'confirmation-code'} autoComplete={'one-time-code'} value={code} onChange={setCode} />
      <ErrorMessage error={error} errorRef={errorRef} />
      <button type={'submit'} disabled={submitting || !email.trim() || !code.trim()}>Xác nhận</button>
      <button className={'button-secondary'} type={'button'} onClick={() => void resend()} disabled={submitting || !email.trim()}>Gửi lại mã</button>
    </form>
  </AuthPage>;
}

export function ForgotPasswordPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState<1 | 2>(1);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const { error, errorRef, showError, clearError } = useFormError();
  if (auth.status === 'authenticated') return <AuthenticatedRedirect />;
  const configured = auth.status !== 'configuration-error';

  async function submit(event: FormEvent) {
    event.preventDefault();
    clearError();
    setSubmitting(true);
    try {
      if (step === 1) {
        const username = normalizeEmail(email);
        if (!username) return showError('Vui lòng nhập email.');
        if (!configured) return showError(accountUnavailableMessage);
        const result = await resetPassword({ username });
        if (result.nextStep.resetPasswordStep === 'CONFIRM_RESET_PASSWORD_WITH_CODE') setStep(2);
        else navigate('/sign-in', { replace: true });
      } else {
        if (!code.trim() || !password || !confirmation) return showError('Vui lòng nhập đầy đủ thông tin.');
        if (password !== confirmation) return showError('Mật khẩu xác nhận không khớp.');
        if (!configured) return showError(accountUnavailableMessage);
        await confirmResetPassword({ username: normalizeEmail(email), confirmationCode: code.trim(), newPassword: password });
        navigate('/sign-in', { replace: true, state: { message: 'Mật khẩu đã được đặt lại. Bạn có thể đăng nhập.' } });
      }
    } catch (cause) {
      showError(message(cause));
    } finally {
      setSubmitting(false);
    }
  }

  return <AuthPage title={'Quên mật khẩu'}>
    <form className={'auth-form'} onSubmit={(event) => void submit(event)} noValidate>
      <Field label={'Email'} name={'reset-email'} type={'email'} autoComplete={'email'} value={email} onChange={setEmail} />
      {step === 2 && <>
        <Field label={'Mã xác nhận'} name={'reset-code'} autoComplete={'one-time-code'} value={code} onChange={setCode} />
        <PasswordField label={'Mật khẩu mới'} name={'new-password'} autoComplete={'new-password'} value={password} onChange={setPassword} />
        <PasswordField label={'Xác nhận mật khẩu mới'} name={'new-password-confirmation'} autoComplete={'new-password'} value={confirmation} onChange={setConfirmation} />
      </>}
      <ErrorMessage error={error} errorRef={errorRef} />
      <button type={'submit'} disabled={submitting || !email.trim() || (step === 2 && (!code.trim() || !password || !confirmation || password !== confirmation))}>{step === 1 ? 'Gửi mã xác nhận' : 'Đặt mật khẩu mới'}</button>
    </form>
    <p className={'auth-links'}><Link to={'/sign-in'}>Quay lại đăng nhập</Link></p>
  </AuthPage>;
}
