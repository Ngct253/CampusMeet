import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { convertActionItemToTaskInputSchema } from '@campusmeet/shared';
import { authenticate } from '../middleware/authentication';
import { handleError } from '../middleware/error-handler';
import { DynamoDbActionItemTaskRepository } from '../repositories/action-item-tasks';
import { DynamoDbCollaborationRepository } from '../repositories/collaboration';
import { DynamoDbMeetingRepository } from '../repositories/dynamodb';
import { DynamoDbMinutesRepository } from '../repositories/minutes';
import { ActionItemTaskService } from '../services/action-item-task-service';
import { getPathParameter, getRequestId, parseBody } from '../utils/request';
import { failure, ok } from '../utils/response';

type ConversionService = Pick<ActionItemTaskService, 'convert'>;

export const createActionItemTaskHandler =
  (service: ConversionService): APIGatewayProxyHandlerV2 =>
  async (event) => {
    const requestId = getRequestId(event);
    try {
      const { userId } = authenticate(event);
      if (event.requestContext.http.method !== 'POST') {
        return failure(requestId, 'Phương thức chưa được hỗ trợ.', 405, 'METHOD_NOT_ALLOWED');
      }
      return ok(
        await service.convert(
          userId,
          getPathParameter(event, 'meetingId'),
          getPathParameter(event, 'actionItemId'),
          parseBody(event, convertActionItemToTaskInputSchema),
        ),
        requestId,
      );
    } catch (error) {
      return handleError(error, requestId);
    }
  };

const repository = new DynamoDbActionItemTaskRepository();
const service = new ActionItemTaskService(
  new DynamoDbMeetingRepository(),
  new DynamoDbMinutesRepository(),
  new DynamoDbCollaborationRepository(),
  repository,
);

export const actionItemTaskHandler = createActionItemTaskHandler(service);
