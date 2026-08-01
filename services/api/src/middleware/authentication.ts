import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { UnauthorizedError } from '../utils/errors';

export interface AuthContext {
  userId: string;
  email?: string;
  username?: string;
}

export function authenticate(event: APIGatewayProxyEventV2): AuthContext {
  const context = event.requestContext as typeof event.requestContext & {
    authorizer?: { jwt?: { claims?: Record<string, unknown> } };
  };
  const claims = context.authorizer?.jwt?.claims;
  if (typeof claims?.sub !== 'string' || !claims.sub) throw new UnauthorizedError();

  const username = claims['cognito:username'] ?? claims.username;
  return {
    userId: claims.sub,
    ...(typeof claims.email === 'string' ? { email: claims.email } : {}),
    ...(typeof username === 'string' ? { username } : {}),
  };
}
