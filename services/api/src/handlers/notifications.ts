import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { authenticate } from '../middleware/authentication';
import { handleError } from '../middleware/error-handler';
import { DynamoDbIdentityRepository } from '../repositories/identity';
import { getPathParameter, getRequestId } from '../utils/request';
import { failure, ok } from '../utils/response';

const notifications = new DynamoDbIdentityRepository();

export const notificationsHandler: APIGatewayProxyHandlerV2 = async (event) => {
  const requestId = getRequestId(event);
  if (event.requestContext.http.method !== 'GET') {
    return failure(requestId, 'Phương thức chưa được hỗ trợ.', 405, 'METHOD_NOT_ALLOWED');
  }
  try {
    return ok(await notifications.listNotifications(authenticate(event).userId), requestId);
  } catch (error) {
    return handleError(error, requestId);
  }
};

export const readNotificationHandler: APIGatewayProxyHandlerV2 = async (event) => {
  const requestId = getRequestId(event);
  if (event.requestContext.http.method !== 'POST') {
    return failure(requestId, 'Phương thức chưa được hỗ trợ.', 405, 'METHOD_NOT_ALLOWED');
  }
  try {
    await notifications.markNotificationRead(
      authenticate(event).userId,
      getPathParameter(event, 'notificationId'),
    );
    return ok({ read: true }, requestId);
  } catch (error) {
    return handleError(error, requestId);
  }
};
