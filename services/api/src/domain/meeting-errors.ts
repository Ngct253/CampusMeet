export type MeetingErrorCode =
  'VALIDATION_ERROR' | 'UNAUTHORIZED' | 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT';
export class MeetingError extends Error {
  constructor(
    public readonly code: MeetingErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'MeetingError';
  }
  get statusCode(): number {
    return {
      VALIDATION_ERROR: 400,
      UNAUTHORIZED: 401,
      FORBIDDEN: 403,
      NOT_FOUND: 404,
      CONFLICT: 409,
    }[this.code];
  }
}
