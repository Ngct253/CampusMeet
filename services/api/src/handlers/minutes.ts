import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { meetingMinutesInputSchema } from '@campusmeet/shared';
import { authenticate } from '../middleware/authentication';
import { handleError } from '../middleware/error-handler';
import { DynamoDbCollaborationRepository } from '../repositories/collaboration';
import { DynamoDbMeetingRepository } from '../repositories/dynamodb';
import { DynamoDbMinutesRepository } from '../repositories/minutes';
import { MinutesService } from '../services/minutes-service';
import { getPathParameter, getRequestId, parseBody } from '../utils/request';
import { failure, ok } from '../utils/response';

const service = new MinutesService(
  new DynamoDbMinutesRepository(),
  new DynamoDbMeetingRepository(),
  new DynamoDbCollaborationRepository(),
);

export const minutesHandler: APIGatewayProxyHandlerV2 = async (event) => {
  const requestId = getRequestId(event);
  try {
    const { userId } = authenticate(event);
    const meetingId = getPathParameter(event, 'meetingId');
    if (event.requestContext.http.method === 'GET') {
      return ok(await service.getLatest(userId, meetingId), requestId);
    }
    if (event.requestContext.http.method === 'PUT') {
      return ok(
        await service.update(userId, meetingId, parseBody(event, meetingMinutesInputSchema)),
        requestId,
      );
    }
    return failure(requestId, 'Phương thức chưa được hỗ trợ.', 405, 'METHOD_NOT_ALLOWED');
  } catch (error) {
    return handleError(error, requestId);
  }
};
