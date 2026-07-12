import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { getRequestId } from '../utils/request';
import { failure, ok } from '../utils/response';

export const meHandler: APIGatewayProxyHandlerV2 = async (event) => {
  const context = event.requestContext as typeof event.requestContext & {
    authorizer?: { jwt?: { claims?: Record<string, unknown> } };
  };
  const claims = context.authorizer?.jwt?.claims;
  if (!claims?.sub) return failure(getRequestId(event), 'Không tìm thấy JWT claims đã xác thực.', 401);
  return ok({
    userId: String(claims.sub),
    ...(claims.email ? { email: String(claims.email) } : {}),
    ...(claims['cognito:username'] ?? claims.username
      ? { username: String(claims['cognito:username'] ?? claims.username) }
      : {}),
  }, getRequestId(event));
};
