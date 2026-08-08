import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { taskInputSchema, updateTaskStatusInputSchema } from '@campusmeet/shared';
import { MeetingService } from '../application/meeting-service';
import { authenticate } from '../middleware/authentication';
import { SharedMembershipAuthorizer } from '../middleware/authorization';
import { handleError } from '../middleware/error-handler';
import { DynamoDbCollaborationRepository } from '../repositories/collaboration';
import { DynamoDbMeetingRepository } from '../repositories/dynamodb';
import { DynamoDbTaskRepository } from '../repositories/tasks';
import { TaskService } from '../services/task-service';
import { getPathParameter, getRequestId, parseBody, requireIdempotencyKey } from '../utils/request';
import { failure, ok } from '../utils/response';

export const taskRepository = new DynamoDbTaskRepository();
const meetings = new MeetingService(
  new DynamoDbMeetingRepository(),
  new SharedMembershipAuthorizer(),
);
export const taskService = new TaskService(
  taskRepository,
  new DynamoDbCollaborationRepository(),
  meetings,
);

export const tasksHandler: APIGatewayProxyHandlerV2 = async (event) => {
  const requestId = getRequestId(event);
  try {
    const { userId } = authenticate(event);
    if (event.requestContext.http.method === 'GET') {
      return ok(await taskRepository.listByAssignee(userId), requestId);
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

export const taskStatusHandler: APIGatewayProxyHandlerV2 = async (event) => {
  const requestId = getRequestId(event);
  try {
    const { userId } = authenticate(event);
    if (event.requestContext.http.method !== 'PATCH') {
      return failure(requestId, 'Phương thức chưa được hỗ trợ.', 405, 'METHOD_NOT_ALLOWED');
    }
    return ok(
      await taskService.updateTaskStatus(
        userId,
        getPathParameter(event, 'taskId'),
        parseBody(event, updateTaskStatusInputSchema),
      ),
      requestId,
    );
  } catch (error) {
    return handleError(error, requestId);
  }
};
