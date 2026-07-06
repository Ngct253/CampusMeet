import type { APIGatewayProxyEventV2 } from 'aws-lambda';

export interface AuthContext {
  userId: string;
}

export function authenticate(_event: APIGatewayProxyEventV2): AuthContext {
  // TODO(M3): verify the Cognito JWT authorizer claims and return a trusted user identity.
  throw new Error('Authentication middleware is not implemented');
}
