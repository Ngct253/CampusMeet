import type { APIGatewayProxyEventV2 } from 'aws-lambda';

export const getRequestId = (event: APIGatewayProxyEventV2): string =>
  event.requestContext.requestId || crypto.randomUUID();

export function parseJson<T>(event: APIGatewayProxyEventV2): T | undefined {
  // TODO(M3): validate DTO schema at the HTTP boundary before business logic is added.
  return event.body ? (JSON.parse(event.body) as T) : undefined;
}
