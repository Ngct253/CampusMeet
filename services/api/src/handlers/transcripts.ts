import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { updateTranscriptSegmentRequestSchema } from '@campusmeet/shared';
import { authenticate } from '../middleware/authentication';
import { handleError } from '../middleware/error-handler';
import { DynamoDbCollaborationRepository } from '../repositories/collaboration';
import { DynamoDbMeetingRepository } from '../repositories/dynamodb';
import { DynamoDbTranscriptRepository } from '../repositories/transcripts';
import { TranscriptService } from '../services/transcript-service';
import { BadRequestError } from '../utils/errors';
import { getPathParameter, getRequestId, parseBody } from '../utils/request';
import { ok } from '../utils/response';

const service = new TranscriptService(
  new DynamoDbTranscriptRepository(),
  new DynamoDbMeetingRepository(),
  new DynamoDbCollaborationRepository(),
);
export const meetingTranscriptsHandler: APIGatewayProxyHandlerV2 = async (event) => {
  const requestId = getRequestId(event);
  try {
    const { userId } = authenticate(event);
    const meetingId = getPathParameter(event, 'meetingId');
    const rawLimit = event.queryStringParameters?.limit;
    const limit = rawLimit === undefined ? 50 : Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new BadRequestError('limit phải là số nguyên từ 1 đến 100.');
    return ok(
      await service.get(userId, meetingId, limit, event.queryStringParameters?.cursor),
      requestId,
    );
  } catch (error) {
    return handleError(error, requestId);
  }
};
export const transcriptSegmentHandler: APIGatewayProxyHandlerV2 = async (event) => {
  const requestId = getRequestId(event);
  try {
    const { userId } = authenticate(event);
    return ok(
      await service.edit(
        userId,
        getPathParameter(event, 'transcriptId'),
        getPathParameter(event, 'segmentId'),
        parseBody(event, updateTranscriptSegmentRequestSchema),
      ),
      requestId,
    );
  } catch (error) {
    return handleError(error, requestId);
  }
};
