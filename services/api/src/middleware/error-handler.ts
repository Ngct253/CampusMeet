import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { logger } from '../utils/logger';
import { ApiError } from '../utils/errors';
import { failure } from '../utils/response';

export function handleError(error: unknown, requestId: string): APIGatewayProxyStructuredResultV2 {
  if (error instanceof ApiError) {
    return failure(requestId, error.message, error.statusCode, error.code, error.details);
  }
  logger.error('Unhandled API error', {
    requestId,
    error: error instanceof Error ? error.message : 'unknown',
  });
  return failure(requestId, 'Đã xảy ra lỗi nội bộ.');
}
