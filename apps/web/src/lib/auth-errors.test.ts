import { describe, expect, it } from 'vitest';
import {
  fallbackAuthMessage,
  forgotPasswordNeutralMessage,
  mapAuthError,
  normalizeEmail,
  validateConfirmationCode,
  validateEmail,
  validatePassword,
} from './auth-errors';

const cognitoError = (name: string, message = '') => Object.assign(new Error(message), { name });

describe('auth error policy', () => {
  it('chuẩn hóa email và từ chối email sai định dạng', () => {
    expect(normalizeEmail(' Lan@Example.EDU ')).toBe('lan@example.edu');
    expect(validateEmail('not-an-email')).toBe('Email không hợp lệ.');
  });

  it('chỉ chấp nhận mã xác nhận gồm 6 chữ số', () => {
    expect(validateConfirmationCode('123456')).toBeUndefined();
    expect(validateConfirmationCode('12A456')).toBe('Mã xác nhận gồm 6 chữ số.');
  });

  it.each([
    ['PASSWORD123!', 'Mật khẩu phải có ít nhất một chữ thường.'],
    ['password123!', 'Mật khẩu phải có ít nhất một chữ hoa.'],
    ['Password!', 'Mật khẩu phải có ít nhất một chữ số.'],
    ['Password123', 'Mật khẩu phải có ít nhất một ký tự đặc biệt.'],
  ])('validatePassword(%s)', (password, expected) => {
    expect(validatePassword(password)).toContain(expected);
  });

  it('chấp nhận dấu cách ở giữa như ký tự đặc biệt của Cognito', () => {
    expect(validatePassword('Password 123')).not.toContain(
      'Mật khẩu phải có ít nhất một ký tự đặc biệt.',
    );
  });

  it('ánh xạ UsernameExistsException vào field email', () => {
    expect(mapAuthError(cognitoError('UsernameExistsException'), 'sign-up')).toEqual({
      field: 'email',
      message: 'Email đã được đăng ký.',
    });
  });

  it('không phân biệt email không tồn tại với mật khẩu sai khi đăng nhập', () => {
    const expected = 'Email hoặc mật khẩu không đúng.';
    expect(mapAuthError(cognitoError('NotAuthorizedException'), 'sign-in').message).toBe(expected);
    expect(mapAuthError(cognitoError('UserNotFoundException'), 'sign-in').message).toBe(expected);
  });

  it('ánh xạ tài khoản chưa xác nhận', () => {
    expect(mapAuthError(cognitoError('UserNotConfirmedException'), 'sign-in').message).toBe(
      'Tài khoản chưa được xác nhận.',
    );
  });

  it('ánh xạ mã sai và mã hết hạn', () => {
    expect(mapAuthError(cognitoError('CodeMismatchException'), 'confirm-sign-up')).toEqual({
      field: 'code',
      message: 'Mã xác nhận không đúng.',
    });
    expect(mapAuthError(cognitoError('ExpiredCodeException'), 'confirm-reset-password')).toEqual({
      field: 'code',
      message: 'Mã xác nhận đã hết hạn. Vui lòng gửi mã mới.',
    });
  });

  it('không tiết lộ tài khoản trong forgot-password', () => {
    expect(mapAuthError(cognitoError('UserNotFoundException'), 'forgot-password')).toEqual({
      neutral: true,
      message: forgotPasswordNeutralMessage,
    });
  });

  it('dùng message Cognito chỉ để chọn điều kiện InvalidPasswordException', () => {
    expect(
      mapAuthError(
        cognitoError(
          'InvalidPasswordException',
          'Password did not conform with policy: Password must have symbol characters',
        ),
        'confirm-reset-password',
      ),
    ).toEqual({
      field: 'password',
      message: 'Mật khẩu phải có ít nhất một ký tự đặc biệt.',
    });
  });

  it('ánh xạ lỗi mạng mà không lộ chi tiết kỹ thuật', () => {
    expect(
      mapAuthError(new TypeError('Failed to fetch internal endpoint'), 'sign-in').message,
    ).toBe('Không thể kết nối đến dịch vụ xác thực. Vui lòng kiểm tra mạng và thử lại.');
  });

  it('lỗi không xác định dùng fallback và không lộ raw message', () => {
    const raw = 'Internal AWS stack trace and identifier';
    const result = mapAuthError(cognitoError('UnknownException', raw), 'sign-up');
    expect(result.message).toBe(fallbackAuthMessage);
    expect(result.message).not.toContain(raw);
  });
});
