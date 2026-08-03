import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { taskInputSchema } from '@campusmeet/shared';
import { authenticate } from '../middleware/authentication';
import { handleError } from '../middleware/error-handler';
import { DynamoDbCollaborationRepository } from '../repositories/collaboration';
import { DynamoDbMeetingRepository } from '../repositories/dynamodb';
import { DynamoDbTaskRepository } from '../repositories/tasks';
import { TaskService } from '../services/task-service';
import { getRequestId, parseBody, requireIdempotencyKey } from '../utils/request';
import { failure, ok } from '../utils/response';

const tasks = new DynamoDbTaskRepository();
const taskService = new TaskService(
  tasks,
  new DynamoDbCollaborationRepository(),
  new DynamoDbMeetingRepository(),
);

export const tasksHandler: APIGatewayProxyHandlerV2 = async (event) => {
  const requestId = getRequestId(event);
  try {
    const { userId } = authenticate(event);
    if (event.requestContext.http.method === 'GET') {
      return ok(await tasks.listByAssignee(userId), requestId);
    }
    if (event.requestContext.http.method === 'POST') {
      return ok(
        await taskService.createTask(
          userId,
          parseBody(event, taskInputSchema),
          requireIdempotencyKey(event),
        ),
        requestId,
      );
    }
    return failure(requestId, 'Phương thức chưa được hỗ trợ.', 405, 'METHOD_NOT_ALLOWED');
  } catch (error) {
    return handleError(error, requestId);
  }
};
