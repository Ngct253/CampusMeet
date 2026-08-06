import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import {
  GoogleOAuthService,
  SecretsManagerGoogleCredentialsProvider,
} from '../integrations/google-oauth';
import { authenticate } from '../middleware/authentication';
import { handleError } from '../middleware/error-handler';
import { GoogleIntegrationRepository } from '../repositories/google-integration';
import { getRequestId } from '../utils/request';
import { ok } from '../utils/response';

const service = new GoogleOAuthService(
  new GoogleIntegrationRepository(),
  new SecretsManagerGoogleCredentialsProvider(),
);

export const integrationsHandler: APIGatewayProxyHandlerV2 = async (event) => {
  const requestId = getRequestId(event);
  try {
    const auth = authenticate(event);
    if (event.requestContext.http.method !== 'POST') {
      return { statusCode: 405, body: JSON.stringify({ message: 'Method not allowed' }) };
    }
    return ok(await service.createAuthorizationUrl(auth.userId), requestId);
  } catch (error) {
    return handleError(error, requestId);
  }
};

export const googleOAuthCallbackHandler: APIGatewayProxyHandlerV2 = async (event) => {
  const requestId = getRequestId(event);
  try {
    const code = event.queryStringParameters?.code ?? '';
    const state = event.queryStringParameters?.state ?? '';
    await service.complete(code, state);
    const frontend = process.env.FRONTEND_ORIGIN?.replace(/\/$/, '');
    if (!frontend) return ok({ connected: true }, requestId);
    return {
      statusCode: 302,
      headers: { location: `${frontend}/app/meetings?google=connected` },
    };
  } catch (error) {
    return handleError(error, requestId);
  }
};
