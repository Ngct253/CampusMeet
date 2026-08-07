import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { authenticate } from '../middleware/authentication';
import { requireGroupMembership } from '../middleware/authorization';
import { handleError } from '../middleware/error-handler';
import { DynamoDbMeetingRepository } from '../repositories/dynamodb';
import { ApiError, ResourceNotFoundError } from '../utils/errors';
import { getRequestId } from '../utils/request';
import { ok } from '../utils/response';

const meetings = new DynamoDbMeetingRepository();

export const meetContextHandler: APIGatewayProxyHandlerV2 = async (event) => {
  const requestId = getRequestId(event);
  try {
    if (event.requestContext.http.method !== 'GET') {
      throw new ApiError('METHOD_NOT_ALLOWED', 'Phương thức chưa được hỗ trợ.', 405);
    }
    const actor = authenticate(event);
    const googleMeetingId = event.queryStringParameters?.meetingId?.trim();
    if (!googleMeetingId) {
      throw new ApiError('BAD_REQUEST', 'Thiếu Google meetingId.', 400);
    }
    const meeting = await meetings.getByGoogleMeetingId(googleMeetingId);
    if (!meeting) throw new ResourceNotFoundError('Google Meet này chưa được liên kết.');
    await requireGroupMembership(actor.userId, meeting.groupId);
    return ok(meeting, requestId);
  } catch (error) {
    return handleError(error, requestId);
  }
};
