import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { getRequestId } from '../utils/request';
import { ok } from '../utils/response';

export const healthHandler: APIGatewayProxyHandlerV2 = async (event) =>
  ok(
    { service: 'campusmeet-api', status: 'ok', timestamp: new Date().toISOString() },
    getRequestId(event),
  );
