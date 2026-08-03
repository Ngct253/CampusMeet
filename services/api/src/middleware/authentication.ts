import type { APIGatewayProxyEventV2 } from 'aws-lambda';

export interface AuthContext {
  userId: string;
}

export function authenticate(_event: APIGatewayProxyEventV2): AuthContext {
  const context = _event.requestContext as typeof _event.requestContext & {
    authorizer?: { jwt?: { claims?: Record<string, unknown> } };
  };
  const sub = context.authorizer?.jwt?.claims?.sub;
  if (!sub)
    throw new (class extends Error {
      statusCode = 401;
      code = 'UNAUTHORIZED';
    })('Không tìm thấy JWT claims đã xác thực.');
  return { userId: String(sub) };
}
