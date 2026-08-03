import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { authenticate } from '../middleware/authentication';
import { handleError } from '../middleware/error-handler';
import { DynamoDbTaskRepository } from '../repositories/tasks';
import { getRequestId } from '../utils/request';
import { failure, ok } from '../utils/response';

const tasks = new DynamoDbTaskRepository();

export const tasksHandler: APIGatewayProxyHandlerV2 = async (event) => {
  const requestId = getRequestId(event);
  if (event.requestContext.http.method !== 'GET') {
    return failure(requestId, 'Phương thức chưa được hỗ trợ.', 405, 'METHOD_NOT_ALLOWED');
  }
  try {
    const { userId } = authenticate(event);
    return ok(await tasks.listByAssignee(userId), requestId);
  } catch (error) {
    return handleError(error, requestId);
  }
};
