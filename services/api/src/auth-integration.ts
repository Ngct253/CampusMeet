import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { healthHandler } from './handlers/health';
import { meHandler } from './handlers/me';

const routes: Record<string, APIGatewayProxyHandlerV2> = {
  'GET /health': healthHandler,
  'GET /me': meHandler,
};

export const handler: APIGatewayProxyHandlerV2 = async (event, context, callback) => {
  const route = routes[`${event.requestContext.http.method} ${event.rawPath}`];
  if (!route) return { statusCode: 404, body: JSON.stringify({ message: 'Not found' }) };
  return (await route(event, context, callback)) ?? { statusCode: 500 };
};
