import { ApiError } from '../utils/errors';

const status = {
  VALIDATION_ERROR: 400,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
} as const;

export class MeetingError extends ApiError {
  constructor(code: keyof typeof status, message: string) {
    super(code, message, status[code]);
  }
}
