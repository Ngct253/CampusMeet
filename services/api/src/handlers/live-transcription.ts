import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import {
  appendFinalSegmentsRequestSchema, createRecordingRequestSchema, finalizeLiveSessionRequestSchema,
  prepareRecordingUploadRequestSchema, reportGapRequestSchema, startLiveSessionRequestSchema,
} from '@campusmeet/shared';
import { authenticate } from '../middleware/authentication';
import { handleError } from '../middleware/error-handler';
import { DynamoDbCollaborationRepository } from '../repositories/collaboration';
import { DynamoDbMeetingRepository } from '../repositories/dynamodb';
import { DynamoDbLiveTranscriptionRepository } from '../repositories/live-transcription';
import { AmazonTranscribeConnectionSigner } from '../integrations/amazon-transcribe';
import { attachmentObjectStore } from '../integrations/s3';
import { LiveTranscriptionService } from '../services/live-transcription-service';
import { getPathParameter, getRequestId, parseBody, requireIdempotencyKey } from '../utils/request';
import { ok } from '../utils/response';

const service = new LiveTranscriptionService(
  new DynamoDbLiveTranscriptionRepository(), new DynamoDbMeetingRepository(),
  new DynamoDbCollaborationRepository(), new AmazonTranscribeConnectionSigner(), attachmentObjectStore,
);
const handle = (action: (event: Parameters<APIGatewayProxyHandlerV2>[0], actorId: string) => Promise<unknown>): APIGatewayProxyHandlerV2 => async (event) => {
  const requestId = getRequestId(event);
  try { const { userId } = authenticate(event); return ok(await action(event, userId), requestId); }
  catch (error) { return handleError(error, requestId); }
};

export const meetingRecordingsHandler = handle((event, actorId) => service.createRecording(
  actorId, getPathParameter(event, 'meetingId'), requireIdempotencyKey(event),
  parseBody(event, createRecordingRequestSchema),
));
export const prepareRecordingUploadHandler = handle((event, actorId) => service.prepareRecordingUpload(
  actorId, getPathParameter(event, 'meetingId'), getPathParameter(event, 'recordingId'),
  parseBody(event, prepareRecordingUploadRequestSchema),
));
export const completeRecordingHandler = handle((event, actorId) => service.completeRecording(
  actorId, getPathParameter(event, 'meetingId'), getPathParameter(event, 'recordingId'),
));
export const startLiveTranscriptionHandler = handle((event, actorId) => service.start(
  actorId, getPathParameter(event, 'meetingId'), requireIdempotencyKey(event),
  parseBody(event, startLiveSessionRequestSchema),
));
export const liveTranscriptionSessionHandler = handle((event, actorId) => service.get(
  actorId, getPathParameter(event, 'meetingId'), getPathParameter(event, 'sessionId'),
));
export const liveTranscriptionHeartbeatHandler = handle((event, actorId) => service.heartbeat(
  actorId, getPathParameter(event, 'meetingId'), getPathParameter(event, 'sessionId'),
));
export const reconnectLiveTranscriptionHandler = handle((event, actorId) => service.reconnect(
  actorId, getPathParameter(event, 'meetingId'), getPathParameter(event, 'sessionId'),
));
export const appendLiveTranscriptionSegmentsHandler = handle((event, actorId) => service.append(
  actorId, getPathParameter(event, 'meetingId'), getPathParameter(event, 'sessionId'),
  parseBody(event, appendFinalSegmentsRequestSchema),
));
export const reportLiveTranscriptionGapHandler = handle((event, actorId) => service.gap(
  actorId, getPathParameter(event, 'meetingId'), getPathParameter(event, 'sessionId'),
  parseBody(event, reportGapRequestSchema),
));
export const stopLiveTranscriptionHandler = handle((event, actorId) => service.finalize(
  actorId, getPathParameter(event, 'meetingId'), getPathParameter(event, 'sessionId'),
  parseBody(event, finalizeLiveSessionRequestSchema),
));
