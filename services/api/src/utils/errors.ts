export class NotImplementedError extends Error {
  constructor(message = 'Chức năng chưa được triển khai') {
    super(message);
    this.name = 'NotImplementedError';
  }
}

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class BadRequestError extends ApiError {
  constructor(message = 'Yêu cầu không hợp lệ.', details?: unknown) {
    super('BAD_REQUEST', message, 400, details);
  }
}

export class ForbiddenError extends ApiError {
  constructor(message = 'Bạn không có quyền thực hiện thao tác này.') {
    super('FORBIDDEN', message, 403);
  }
}

export class UnauthorizedError extends ApiError {
  constructor(message = 'Bạn cần đăng nhập để tiếp tục.') {
    super('UNAUTHORIZED', message, 401);
  }
}

export class ResourceNotFoundError extends ApiError {
  constructor(message = 'Không tìm thấy tài nguyên.') {
    super('NOT_FOUND', message, 404);
  }
}

export class ConflictError extends ApiError {
  constructor(message = 'Tài nguyên đã thay đổi.', details?: unknown) {
    super('CONFLICT', message, 409, details);
  }
}

export class UnprocessableEntityError extends ApiError {
  constructor(message = 'Không thể xử lý yêu cầu.', details?: unknown) {
    super('UNPROCESSABLE_ENTITY', message, 422, details);
  }
}

export class ServiceConfigurationError extends ApiError {
  constructor(message = 'Dịch vụ chưa được cấu hình đầy đủ.') {
    super('SERVICE_UNAVAILABLE', message, 503);
  }
}
