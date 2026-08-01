import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { updateProfileSchema } from '@campusmeet/shared';
import { authenticate } from '../middleware/authentication';
import { handleError } from '../middleware/error-handler';
import { DynamoDbIdentityRepository } from '../repositories/identity';
import { getRequestId, parseBody } from '../utils/request';
import { failure, ok } from '../utils/response';

const identities = new DynamoDbIdentityRepository();

export const meHandler: APIGatewayProxyHandlerV2 = async (event) => {
  const requestId = getRequestId(event);
  try {
    const auth = authenticate(event);
    if (event.requestContext.http.method === 'GET') {
      return ok(await identities.ensureProfile(auth), requestId);
    }
    if (event.requestContext.http.method === 'PATCH') {
      return ok(await identities.updateProfile(auth, parseBody(event, updateProfileSchema)), requestId);
    }
    return failure(requestId, 'Phương thức chưa được hỗ trợ.', 405, 'METHOD_NOT_ALLOWED');
  } catch (error) {
    return handleError(error, requestId);
  }
};
