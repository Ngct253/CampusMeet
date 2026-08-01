import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import type { ZodType } from 'zod';
import { BadRequestError } from './errors';

export const getRequestId = (event: APIGatewayProxyEventV2): string =>
  event.requestContext.requestId || crypto.randomUUID();

export function parseJson<T>(event: APIGatewayProxyEventV2): T | undefined {
  if (!event.body) return undefined;
  try {
    return JSON.parse(event.body) as T;
  } catch {
    throw new BadRequestError('Body phải là JSON hợp lệ.');
  }
}

export function parseBody<T>(event: APIGatewayProxyEventV2, schema: ZodType<T>): T {
  const result = schema.safeParse(parseJson<unknown>(event));
  if (!result.success) {
    throw new BadRequestError(
      'Dữ liệu yêu cầu không hợp lệ.',
      result.error.issues.map(({ code, message, path }) => ({ code, message, path })),
    );
  }
  return result.data;
}

export function getPathParameter(event: APIGatewayProxyEventV2, name: string): string {
  const value = event.pathParameters?.[name];
  if (!value) throw new BadRequestError(`Thiếu path parameter: ${name}.`);
  return value;
}

export function requireIdempotencyKey(event: APIGatewayProxyEventV2): string {
  const value = event.headers['idempotency-key']?.trim();
  if (!value || value.length > 200) {
    throw new BadRequestError('Idempotency-Key hợp lệ là bắt buộc.');
  }
  return value;
}
