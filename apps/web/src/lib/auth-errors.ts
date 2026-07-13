export type AuthField = 'email' | 'password' | 'confirmation' | 'code';
export type AuthOperation =
  | 'sign-up'
  | 'confirm-sign-up'
  | 'resend-code'
  | 'sign-in'
  | 'forgot-password'
  | 'confirm-reset-password';

export type AuthUiError = { message: string; field?: AuthField; neutral?: boolean };

export const fallbackAuthMessage = 'Không thể hoàn tất yêu cầu. Vui lòng thử lại.';
export const accountUnavailableMessage =
  'Tính năng tài khoản hiện chưa khả dụng. Vui lòng thử lại sau.';
export const forgotPasswordNeutralMessage =
  'Nếu tài khoản tồn tại, hướng dẫn khôi phục mật khẩu sẽ được gửi đến email.';
export const resendCodeNeutralMessage = 'Nếu tài khoản cần xác nhận, mã mới sẽ được gửi đến email.';

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

export function validateEmail(email: string) {
  if (!email.trim()) return 'Vui lòng nhập email.';
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(email))
    ? undefined
    : 'Email không hợp lệ.';
}

export function validatePassword(password: string) {
  const errors: string[] = [];
  if (!password) return ['Vui lòng nhập mật khẩu.'];
  if (password.length < 8) errors.push('Mật khẩu phải có ít nhất 8 ký tự.');
  if (!/[a-z]/.test(password)) errors.push('Mật khẩu phải có ít nhất một chữ thường.');
  if (!/[A-Z]/.test(password)) errors.push('Mật khẩu phải có ít nhất một chữ hoa.');
  if (!/\d/.test(password)) errors.push('Mật khẩu phải có ít nhất một chữ số.');
  if (!/[\^$*.[\]{}()?\-"!@#%&/\\,><':;|_~`+=]/.test(password) && !/^.+ .+$/.test(password))
    errors.push('Mật khẩu phải có ít nhất một ký tự đặc biệt.');
  return errors;
}

export function validateConfirmation(password: string, confirmation: string) {
  if (!confirmation) return 'Vui lòng nhập mật khẩu xác nhận.';
  return password === confirmation ? undefined : 'Mật khẩu xác nhận không khớp.';
}

export function validateConfirmationCode(code: string) {
  if (!code.trim()) return 'Vui lòng nhập mã xác nhận.';
  return /^\d{6}$/.test(code.trim()) ? undefined : 'Mã xác nhận gồm 6 chữ số.';
}

function errorDetails(error: unknown) {
  if (!error || typeof error !== 'object') return { name: '', message: '' };
  const value = error as { name?: unknown; code?: unknown; message?: unknown };
  const name = String(value.name ?? '');
  return {
    name: name && name !== 'Error' ? name : String(value.code ?? name),
    message: typeof value.message === 'string' ? value.message : '',
  };
}

function invalidPasswordMessage(message: string) {
  if (/lowercase/i.test(message)) return 'Mật khẩu phải có ít nhất một chữ thường.';
  if (/uppercase/i.test(message)) return 'Mật khẩu phải có ít nhất một chữ hoa.';
  if (/numeric|number/i.test(message)) return 'Mật khẩu phải có ít nhất một chữ số.';
  if (/symbol|special/i.test(message)) return 'Mật khẩu phải có ít nhất một ký tự đặc biệt.';
  if (/length|characters|long enough/i.test(message)) return 'Mật khẩu phải có ít nhất 8 ký tự.';
  return 'Mật khẩu chưa đáp ứng chính sách bảo mật.';
}

export function mapAuthError(error: unknown, operation: AuthOperation): AuthUiError {
  const { name, message } = errorDetails(error);

  if (
    name === 'NetworkError' ||
    (name === 'TypeError' && /fetch|network/i.test(message)) ||
    /failed to fetch|network request failed/i.test(message)
  ) {
    return {
      message: 'Không thể kết nối đến dịch vụ xác thực. Vui lòng kiểm tra mạng và thử lại.',
    };
  }

  if (name === 'TooManyRequestsException' || name === 'LimitExceededException') {
    return {
      message:
        operation === 'sign-in'
          ? 'Bạn đã thử đăng nhập quá nhiều lần. Vui lòng thử lại sau.'
          : 'Bạn đã thực hiện quá nhiều yêu cầu. Vui lòng thử lại sau.',
    };
  }

  if (operation === 'sign-in') {
    if (name === 'NotAuthorizedException' || name === 'UserNotFoundException')
      return { message: 'Email hoặc mật khẩu không đúng.' };
    if (name === 'UserNotConfirmedException') return { message: 'Tài khoản chưa được xác nhận.' };
    if (name === 'PasswordResetRequiredException')
      return { message: 'Bạn cần đặt lại mật khẩu trước khi đăng nhập.' };
  }

  if (operation === 'sign-up') {
    if (name === 'InvalidPasswordException')
      return { field: 'password', message: invalidPasswordMessage(message) };
    if (name === 'UsernameExistsException')
      return { field: 'email', message: 'Email đã được đăng ký.' };
    if (name === 'InvalidParameterException')
      return { message: 'Thông tin đăng ký không hợp lệ. Vui lòng kiểm tra và thử lại.' };
  }

  if (operation === 'confirm-sign-up' || operation === 'confirm-reset-password') {
    if (name === 'CodeMismatchException')
      return { field: 'code', message: 'Mã xác nhận không đúng.' };
    if (name === 'ExpiredCodeException')
      return { field: 'code', message: 'Mã xác nhận đã hết hạn. Vui lòng gửi mã mới.' };
  }

  if (operation === 'confirm-reset-password' && name === 'InvalidPasswordException')
    return { field: 'password', message: invalidPasswordMessage(message) };

  if (operation === 'confirm-sign-up') {
    if (name === 'NotAuthorizedException') return { message: 'Tài khoản đã được xác nhận.' };
    if (name === 'UserNotFoundException')
      return { message: 'Không thể xác nhận tài khoản. Vui lòng kiểm tra thông tin và thử lại.' };
  }

  if (operation === 'resend-code' && name === 'UserNotFoundException')
    return {
      neutral: true,
      message: resendCodeNeutralMessage,
    };

  if (operation === 'forgot-password' && name === 'UserNotFoundException')
    return { neutral: true, message: forgotPasswordNeutralMessage };

  return { message: fallbackAuthMessage };
}
