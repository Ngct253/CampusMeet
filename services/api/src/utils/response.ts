import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import type { ApiErrorResponse, ApiSuccessResponse } from '@campusmeet/shared';

const json = (statusCode: number, body: unknown): APIGatewayProxyStructuredResultV2 => ({
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

export const notImplemented = (requestId: string, module: string) =>
  json(501, {
    success: false,
    error: { code: 'NOT_IMPLEMENTED', message: `${module} mới chỉ có hợp đồng API.` },
    requestId,
  } satisfies ApiErrorResponse);

export const failure = (requestId: string, message: string, statusCode = 500) =>
  json(statusCode, {
    success: false,
    error: { code: 'INTERNAL_ERROR', message },
    requestId,
  } satisfies ApiErrorResponse);
