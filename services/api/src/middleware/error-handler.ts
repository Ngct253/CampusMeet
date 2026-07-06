import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { logger } from '../utils/logger';
import { failure } from '../utils/response';

export function handleError(error: unknown, requestId: string): APIGatewayProxyStructuredResultV2 {
  logger.error('Unhandled API error', {
    requestId,
    error: error instanceof Error ? error.message : 'unknown',
  });
  return failure(requestId, 'Đã xảy ra lỗi nội bộ.');
}
