import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { authenticate } from '../middleware/authentication';
import { handleError } from '../middleware/error-handler';
import { DynamoDbCollaborationRepository } from '../repositories/collaboration';
import { DynamoDbIdentityRepository } from '../repositories/identity';
import { getPathParameter, getRequestId } from '../utils/request';
import { failure, ok } from '../utils/response';

const groups = new DynamoDbCollaborationRepository();
const identities = new DynamoDbIdentityRepository();

const invitationHandler =
  (accept?: boolean): APIGatewayProxyHandlerV2 =>
  async (event) => {
    const requestId = getRequestId(event);
    try {
      const method = event.requestContext.http.method;
      if (
        (accept === undefined && method !== 'GET') ||
        (accept !== undefined && method !== 'POST')
      ) {
        return failure(requestId, 'Phương thức chưa được hỗ trợ.', 405, 'METHOD_NOT_ALLOWED');
      }
      const auth = authenticate(event);
      const profile = await identities.ensureProfile(auth);
      const token = getPathParameter(event, 'token');
      return ok(
        accept === undefined
          ? await groups.getInvitation(token, profile.email)
          : await groups.respondInvitation(token, auth.userId, profile.email, accept),
        requestId,
      );
    } catch (error) {
      return handleError(error, requestId);
    }
  };

export const invitationDetailsHandler = invitationHandler();
export const acceptInvitationHandler = invitationHandler(true);
export const declineInvitationHandler = invitationHandler(false);

export const myInvitationsHandler: APIGatewayProxyHandlerV2 = async (event) => {
  const requestId = getRequestId(event);
  try {
    if (event.requestContext.http.method !== 'GET') {
      return failure(requestId, 'Phương thức chưa được hỗ trợ.', 405, 'METHOD_NOT_ALLOWED');
    }
    const auth = authenticate(event);
    const profile = await identities.ensureProfile(auth);
    return ok(await groups.listInvitationsForEmail(profile.email), requestId);
  } catch (error) {
    return handleError(error, requestId);
  }
};

const directInvitationHandler =
  (accept: boolean): APIGatewayProxyHandlerV2 =>
  async (event) => {
    const requestId = getRequestId(event);
    try {
      if (event.requestContext.http.method !== 'POST') {
        return failure(requestId, 'Phương thức chưa được hỗ trợ.', 405, 'METHOD_NOT_ALLOWED');
      }
      const auth = authenticate(event);
      const profile = await identities.ensureProfile(auth);
      return ok(
        await groups.respondInvitationById(
          getPathParameter(event, 'invitationId'),
          auth.userId,
          profile.email,
          accept,
        ),
        requestId,
      );
    } catch (error) {
      return handleError(error, requestId);
    }
  };

export const acceptDirectInvitationHandler = directInvitationHandler(true);
export const declineDirectInvitationHandler = directInvitationHandler(false);
