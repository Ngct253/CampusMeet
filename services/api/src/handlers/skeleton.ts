import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { getRequestId, parseJson } from '../utils/request';
import { notImplemented } from '../utils/response';

export const createSkeletonHandler =
  <TRequest>(module: string): APIGatewayProxyHandlerV2 =>
  async (event) => {
    if (event.body) parseJson<TRequest>(event);
    // TODO(module owner): validate input, authenticate, authorize group membership, then call an application service.
    return notImplemented(getRequestId(event), module);
  };
