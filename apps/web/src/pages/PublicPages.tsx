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
import {
  accountUnavailableMessage,
  forgotPasswordNeutralMessage,
  mapAuthError,
  normalizeEmail,
  resendCodeNeutralMessage,
  validateConfirmation,
  validateConfirmationCode,
  validateEmail,
  validatePassword,
  type AuthField,
  type AuthOperation,
} from '../lib/auth-errors';

const pendingEmailKey = 'campusmeet:pendingEmail';

function destination() {
  const saved = sessionStorage.getItem('campusmeet:returnTo');
  sessionStorage.removeItem('campusmeet:returnTo');
  return saved === '/app' || saved?.startsWith('/app/') ? saved : '/app/dashboard';
}

function AuthPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className={'auth-page'}>
      <section className={'auth-panel'} aria-labelledby={'auth-title'}>
        <Link className={'brand auth-brand'} to={'/'}>
          CampusMeet
        </Link>
        <h1 id={'auth-title'}>{title}</h1>
        {children}
      </section>
    </main>
  );
}

function Field({
  label,
  name,
  type = 'text',
  autoComplete,
  value,
  onChange,
  errors = [],
}: {
  label: string;
  name: string;
  type?: string;
  autoComplete: string;
  value: string;
  onChange: (value: string) => void;
  errors?: string[];
}) {
  const errorId = `${name}-error`;
  return (
    <div className={'auth-field'}>
      <label htmlFor={name}>{label}</label>
      <input
        id={name}
        name={name}
        type={type}
        autoComplete={autoComplete}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required
        aria-invalid={errors.length > 0}
        aria-describedby={errors.length ? errorId : undefined}
      />
      <FieldErrors id={errorId} errors={errors} />
    </div>
  );
}

function PasswordVisibilityIcon({ visible }: { visible: boolean }) {
  return (
    <svg
      viewBox={'0 0 24 24'}
      width={'20'}
      height={'20'}
      fill={'none'}
      stroke={'currentColor'}
      strokeWidth={'1.8'}
      strokeLinecap={'round'}
      strokeLinejoin={'round'}
      aria-hidden={'true'}
    >
      <path d={'M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z'} />
      <circle cx={'12'} cy={'12'} r={'2.75'} />
      {visible && <path d={'m4 4 16 16'} />}
    </svg>
  );
}

function PasswordField({
  label,
  name,
  autoComplete,
  value,
  onChange,
  errors = [],
}: {
  label: string;
  name: string;
  autoComplete: string;
  value: string;
  onChange: (value: string) => void;
  errors?: string[];
}) {
  const [visible, setVisible] = useState(false);
  const action = visible ? 'Ẩn mật khẩu' : 'Hiện mật khẩu';
  const errorId = `${name}-error`;
  return (
    <div className={'auth-field'}>
      <label htmlFor={name}>{label}</label>
      <div className={'password-control'}>
        <input
          id={name}
          name={name}
          type={visible ? 'text' : 'password'}
          autoComplete={autoComplete}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          required
          aria-invalid={errors.length > 0}
          aria-describedby={errors.length ? errorId : undefined}
        />
        <button
          type={'button'}
          aria-label={action}
          title={action}
          aria-pressed={visible}
          onClick={() => setVisible((current) => !current)}
        >
          <PasswordVisibilityIcon visible={visible} />
        </button>
      </div>
      <FieldErrors id={errorId} errors={errors} />
    </div>
  );
}

function FieldErrors({ id, errors }: { id: string; errors: string[] }) {
  if (!errors.length) return null;
  return errors.length === 1 ? (
    <span className={'auth-field-error'} id={id}>
      {errors[0]}
    </span>
  ) : (
    <ul className={'auth-field-error'} id={id}>
      {errors.map((error) => (
        <li key={error}>{error}</li>
      ))}
    </ul>
  );
}

function ErrorMessage({
  error,
  errorRef,
}: {
  error: string;
  errorRef: React.RefObject<HTMLParagraphElement | null>;
}) {
  return error ? (
    <p className={'auth-error'} ref={errorRef} tabIndex={-1} role={'alert'}>
      {error}
    </p>
  ) : null;
}

function useFormError() {
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<AuthField, string[]>>>({});
  const errorRef = useRef<HTMLParagraphElement>(null);
  const showError = (value: string) => {
    setFieldErrors({});
    setError(value);
    requestAnimationFrame(() => errorRef.current?.focus());
  };
  const showFieldErrors = (
    values: Partial<Record<AuthField, string | string[] | undefined>>,
    ids: Partial<Record<AuthField, string>>,
  ) => {
    const next = Object.fromEntries(
      Object.entries(values)
        .filter(([, value]) => value && (typeof value === 'string' || value.length))
        .map(([field, value]) => [field, typeof value === 'string' ? [value] : value]),
    ) as Partial<Record<AuthField, string[]>>;
    setError('');
    setFieldErrors(next);
    const first = Object.keys(next)[0] as AuthField | undefined;
    if (first) requestAnimationFrame(() => document.getElementById(ids[first] ?? '')?.focus());
    return Object.keys(next).length > 0;
  };
  const showMappedError = (
    cause: unknown,
    operation: AuthOperation,
    ids: Partial<Record<AuthField, string>>,
  ) => {
    const mapped = mapAuthError(cause, operation);
    if (mapped.field) showFieldErrors({ [mapped.field]: mapped.message }, ids);
    else showError(mapped.message);
    return mapped;
  };
  const clearField = (...fields: AuthField[]) => {
    setError('');
    setFieldErrors((current) => {
      const next = { ...current };
      for (const field of fields) delete next[field];
      return next;
    });
  };
  const clearError = () => {
    setError('');
    setFieldErrors({});
  };
  return {
    error,
    errorRef,
    fieldErrors,
    showError,
    showFieldErrors,
    showMappedError,
    clearField,
    clearError,
  };
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
  const {
    error,
    errorRef,
    fieldErrors,
    showError,
    showFieldErrors,
    showMappedError,
    clearField,
    clearError,
  } = useFormError();
  if (auth.status === 'authenticated') return <AuthenticatedRedirect />;
  const configured = auth.status !== 'configuration-error';

  async function submit(event: FormEvent) {
    event.preventDefault();
    clearError();
    const username = normalizeEmail(email);
    if (
      showFieldErrors(
        {
          email: validateEmail(email),
          password: password ? undefined : 'Vui lòng nhập mật khẩu.',
        },
        { email: 'sign-in-email', password: 'sign-in-password' },
      )
    )
      return;
    if (!configured) return showError(accountUnavailableMessage);
    setSubmitting(true);
    try {
      const result = await signIn({ username, password });
      if (result.nextStep.signInStep === 'CONFIRM_SIGN_UP') {
        sessionStorage.setItem(pendingEmailKey, username);
        navigate('/confirm-sign-up');
        return;
      }
      if (!result.isSignedIn)
        return showError('Tài khoản cần thêm một bước xác thực chưa được hỗ trợ.');
      await auth.refreshAuth();
      navigate(destination(), { replace: true });
    } catch (cause) {
      if (cause instanceof Error && cause.name === 'UserNotConfirmedException') {
        sessionStorage.setItem(pendingEmailKey, username);
        navigate('/confirm-sign-up');
      } else
        showMappedError(cause, 'sign-in', {
          email: 'sign-in-email',
          password: 'sign-in-password',
        });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthPage title={'Đăng nhập'}>
      {location.state?.message && (
        <p className={'auth-success'} aria-live={'polite'}>
          {location.state.message}
        </p>
      )}
      <form className={'auth-form'} onSubmit={(event) => void submit(event)} noValidate>
        <Field
          label={'Email'}
          name={'sign-in-email'}
          type={'email'}
          autoComplete={'email'}
          value={email}
          onChange={(value) => {
            setEmail(value);
            clearField('email');
          }}
          errors={fieldErrors.email}
        />
        <PasswordField
          label={'Mật khẩu'}
          name={'sign-in-password'}
          autoComplete={'current-password'}
          value={password}
          onChange={(value) => {
            setPassword(value);
            clearField('password', 'confirmation');
          }}
          errors={fieldErrors.password}
        />
        <ErrorMessage error={error} errorRef={errorRef} />
        <button type={'submit'} disabled={submitting}>
          {submitting ? 'Đang đăng nhập...' : 'Đăng nhập'}
        </button>
      </form>
      <div className={'auth-links'}>
        <Link to={'/forgot-password'}>Quên mật khẩu</Link>
        <Link to={'/sign-up'}>Tạo tài khoản</Link>
      </div>
    </AuthPage>
  );
}

export function SignUpPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const {
    error,
    errorRef,
    fieldErrors,
    showError,
    showFieldErrors,
    showMappedError,
    clearField,
    clearError,
  } = useFormError();
  if (auth.status === 'authenticated') return <AuthenticatedRedirect />;
  const configured = auth.status !== 'configuration-error';

  async function submit(event: FormEvent) {
    event.preventDefault();
    clearError();
    const username = normalizeEmail(email);
    if (
      showFieldErrors(
        {
          email: validateEmail(email),
          password: validatePassword(password),
          confirmation: validateConfirmation(password, confirmation),
        },
        {
          email: 'sign-up-email',
          password: 'sign-up-password',
          confirmation: 'sign-up-confirmation',
        },
      )
    )
      return;
    if (!configured) return showError(accountUnavailableMessage);
    setSubmitting(true);
    try {
      const result = await signUp({
        username,
        password,
        options: { userAttributes: { email: username } },
      });
      if (result.isSignUpComplete) {
        navigate('/sign-in', {
          replace: true,
          state: { message: 'Tài khoản đã được tạo. Bạn có thể đăng nhập.' },
        });
      } else if (result.nextStep.signUpStep === 'CONFIRM_SIGN_UP') {
        sessionStorage.setItem(pendingEmailKey, username);
        navigate('/confirm-sign-up');
      } else {
        showError('Tài khoản cần thêm một bước xác thực chưa được hỗ trợ.');
      }
    } catch (cause) {
      showMappedError(cause, 'sign-up', {
        email: 'sign-up-email',
        password: 'sign-up-password',
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthPage title={'Tạo tài khoản'}>
      <form className={'auth-form'} onSubmit={(event) => void submit(event)} noValidate>
        <Field
          label={'Email'}
          name={'sign-up-email'}
          type={'email'}
          autoComplete={'email'}
          value={email}
          onChange={(value) => {
            setEmail(value);
            clearField('email');
          }}
          errors={fieldErrors.email}
        />
        <PasswordField
          label={'Mật khẩu'}
          name={'sign-up-password'}
          autoComplete={'new-password'}
          value={password}
          onChange={(value) => {
            setPassword(value);
            clearField('password', 'confirmation');
          }}
          errors={fieldErrors.password}
        />
        <PasswordField
          label={'Xác nhận mật khẩu'}
          name={'sign-up-confirmation'}
          autoComplete={'new-password'}
          value={confirmation}
          onChange={(value) => {
            setConfirmation(value);
            clearField('confirmation');
          }}
          errors={fieldErrors.confirmation}
        />
        <ErrorMessage error={error} errorRef={errorRef} />
        <button type={'submit'} disabled={submitting}>
          {submitting ? 'Đang tạo tài khoản...' : 'Tạo tài khoản'}
        </button>
      </form>
      <p className={'auth-links'}>
        Đã có tài khoản? <Link to={'/sign-in'}>Đăng nhập</Link>
      </p>
    </AuthPage>
  );
}

export function ConfirmSignUpPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState(() => sessionStorage.getItem(pendingEmailKey) ?? '');
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState('');
  const {
    error,
    errorRef,
    fieldErrors,
    showError,
    showFieldErrors,
    showMappedError,
    clearField,
    clearError,
  } = useFormError();
  if (auth.status === 'authenticated') return <AuthenticatedRedirect />;
  const configured = auth.status !== 'configuration-error';

  async function submit(event: FormEvent) {
    event.preventDefault();
    clearError();
    const username = normalizeEmail(email);
    if (
      showFieldErrors(
        {
          email: validateEmail(email),
          code: validateConfirmationCode(code),
        },
        { email: 'confirm-email', code: 'confirmation-code' },
      )
    )
      return;
    if (!configured) return showError(accountUnavailableMessage);
    setSubmitting(true);
    try {
      await confirmSignUp({ username, confirmationCode: code.trim() });
      sessionStorage.removeItem(pendingEmailKey);
      navigate('/sign-in', {
        replace: true,
        state: { message: 'Tài khoản đã được xác nhận. Bạn có thể đăng nhập.' },
      });
    } catch (cause) {
      showMappedError(cause, 'confirm-sign-up', {
        email: 'confirm-email',
        code: 'confirmation-code',
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function resend() {
    clearError();
    const username = normalizeEmail(email);
    if (showFieldErrors({ email: validateEmail(email) }, { email: 'confirm-email' })) return;
    if (!configured) return showError(accountUnavailableMessage);
    setSubmitting(true);
    try {
      await resendSignUpCode({ username });
      setNotice(resendCodeNeutralMessage);
    } catch (cause) {
      const mapped = mapAuthError(cause, 'resend-code');
      if (mapped.neutral) setNotice(mapped.message);
      else showMappedError(cause, 'resend-code', { email: 'confirm-email' });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthPage title={'Xác nhận tài khoản'}>
      {notice && (
        <p className={'auth-success'} aria-live={'polite'}>
          {notice}
        </p>
      )}
      <form className={'auth-form'} onSubmit={(event) => void submit(event)} noValidate>
        <Field
          label={'Email'}
          name={'confirm-email'}
          type={'email'}
          autoComplete={'email'}
          value={email}
          onChange={(value) => {
            setEmail(value);
            clearField('email');
          }}
          errors={fieldErrors.email}
        />
        <Field
          label={'Mã xác nhận'}
          name={'confirmation-code'}
          autoComplete={'one-time-code'}
          value={code}
          onChange={(value) => {
            setCode(value);
            clearField('code');
          }}
          errors={fieldErrors.code}
        />
        <ErrorMessage error={error} errorRef={errorRef} />
        <button type={'submit'} disabled={submitting}>
          Xác nhận
        </button>
        <button
          className={'button-secondary'}
          type={'button'}
          onClick={() => void resend()}
          disabled={submitting}
        >
          Gửi lại mã
        </button>
      </form>
    </AuthPage>
  );
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
  const [notice, setNotice] = useState('');
  const {
    error,
    errorRef,
    fieldErrors,
    showError,
    showFieldErrors,
    showMappedError,
    clearField,
    clearError,
  } = useFormError();
  if (auth.status === 'authenticated') return <AuthenticatedRedirect />;
  const configured = auth.status !== 'configuration-error';

  async function submit(event: FormEvent) {
    event.preventDefault();
    clearError();
    setNotice('');
    try {
      if (step === 1) {
        const username = normalizeEmail(email);
        if (showFieldErrors({ email: validateEmail(email) }, { email: 'reset-email' })) return;
        if (!configured) return showError(accountUnavailableMessage);
        setSubmitting(true);
        const result = await resetPassword({ username });
        setNotice(forgotPasswordNeutralMessage);
        if (result.nextStep.resetPasswordStep === 'CONFIRM_RESET_PASSWORD_WITH_CODE') setStep(2);
        else navigate('/sign-in', { replace: true });
      } else {
        if (
          showFieldErrors(
            {
              code: validateConfirmationCode(code),
              password: validatePassword(password),
              confirmation: validateConfirmation(password, confirmation),
            },
            {
              code: 'reset-code',
              password: 'new-password',
              confirmation: 'new-password-confirmation',
            },
          )
        )
          return;
        if (!configured) return showError(accountUnavailableMessage);
        setSubmitting(true);
        await confirmResetPassword({
          username: normalizeEmail(email),
          confirmationCode: code.trim(),
          newPassword: password,
        });
        navigate('/sign-in', {
          replace: true,
          state: { message: 'Mật khẩu đã được đặt lại. Bạn có thể đăng nhập.' },
        });
      }
    } catch (cause) {
      const operation = step === 1 ? 'forgot-password' : 'confirm-reset-password';
      const mapped = mapAuthError(cause, operation);
      if (operation === 'forgot-password' && mapped.neutral) {
        setNotice(mapped.message);
        setStep(2);
      } else {
        showMappedError(cause, operation, {
          email: 'reset-email',
          code: 'reset-code',
          password: 'new-password',
        });
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthPage title={'Quên mật khẩu'}>
      {notice && (
        <p className={'auth-success'} aria-live={'polite'}>
          {notice}
        </p>
      )}
      <form className={'auth-form'} onSubmit={(event) => void submit(event)} noValidate>
        <Field
          label={'Email'}
          name={'reset-email'}
          type={'email'}
          autoComplete={'email'}
          value={email}
          onChange={(value) => {
            setEmail(value);
            clearField('email');
          }}
          errors={fieldErrors.email}
        />
        {step === 2 && (
          <>
            <Field
              label={'Mã xác nhận'}
              name={'reset-code'}
              autoComplete={'one-time-code'}
              value={code}
              onChange={(value) => {
                setCode(value);
                clearField('code');
              }}
              errors={fieldErrors.code}
            />
            <PasswordField
              label={'Mật khẩu mới'}
              name={'new-password'}
              autoComplete={'new-password'}
              value={password}
              onChange={(value) => {
                setPassword(value);
                clearField('password');
              }}
              errors={fieldErrors.password}
            />
            <PasswordField
              label={'Xác nhận mật khẩu mới'}
              name={'new-password-confirmation'}
              autoComplete={'new-password'}
              value={confirmation}
              onChange={(value) => {
                setConfirmation(value);
                clearField('confirmation');
              }}
              errors={fieldErrors.confirmation}
            />
          </>
        )}
        <ErrorMessage error={error} errorRef={errorRef} />
        <button type={'submit'} disabled={submitting}>
          {submitting ? 'Đang xử lý...' : step === 1 ? 'Gửi mã xác nhận' : 'Đặt mật khẩu mới'}
        </button>
      </form>
      <p className={'auth-links'}>
        <Link to={'/sign-in'}>Quay lại đăng nhập</Link>
      </p>
    </AuthPage>
  );
}
