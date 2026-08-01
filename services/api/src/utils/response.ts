import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import type { ApiErrorResponse, ApiSuccessResponse } from '@campusmeet/shared';

export const json = (statusCode: number, body: unknown): APIGatewayProxyStructuredResultV2 => ({
  statusCode,
  headers: { 'content-type': 'application/json; charset=utf-8' },
  body: JSON.stringify(body),
});

export const ok = <T>(data: T, requestId: string, isMock = false) =>
  json(200, {
    success: true,
    data,
    requestId,
    ...(isMock && { isMock: true }),
  } satisfies ApiSuccessResponse<T>);

export const accepted = <T>(data: T, requestId: string) =>
  json(202, {
    success: true,
    data,
    requestId,
  } satisfies ApiSuccessResponse<T>);

export const notImplemented = (requestId: string, module: string) =>
  json(501, {
    success: false,
    error: { code: 'NOT_IMPLEMENTED', message: `${module} mới chỉ có hợp đồng API.` },
    requestId,
  } satisfies ApiErrorResponse);

export const failure = (
  requestId: string,
  message: string,
  statusCode = 500,
  code = 'INTERNAL_ERROR',
  details?: unknown,
) =>
  json(statusCode, {
    success: false,
    error: { code, message, ...(details === undefined ? {} : { details }) },
    requestId,
  } satisfies ApiErrorResponse);
