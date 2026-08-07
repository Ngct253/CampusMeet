import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import {
  completeUploadRequestSchema,
  uploadAttachmentRequestSchema,
} from '@campusmeet/shared';
import { authenticate } from '../middleware/authentication';
import { requireGroupMembership } from '../middleware/authorization';
import { handleError } from '../middleware/error-handler';
import { DynamoDbAttachmentRepository } from '../repositories/attachments';
import { DynamoDbMeetingRepository } from '../repositories/dynamodb';
import { ApiError, ResourceNotFoundError } from '../utils/errors';
import { getPathParameter, getRequestId, parseBody } from '../utils/request';
import { ok } from '../utils/response';

const attachments = new DynamoDbAttachmentRepository();
const meetings = new DynamoDbMeetingRepository();

const handler =
  (
    action: (event: Parameters<APIGatewayProxyHandlerV2>[0]) => Promise<unknown>,
  ): APIGatewayProxyHandlerV2 =>
  async (event) => {
    const requestId = getRequestId(event);
    try {
      return ok(await action(event), requestId);
    } catch (error) {
      return handleError(error, requestId);
    }
  };

const getMeetingOrFail = async (meetingId: string) => {
  const meeting = await meetings.getById(meetingId);
  if (!meeting) throw new ResourceNotFoundError('Không tìm thấy cuộc họp.');
  return meeting;
};

export const meetingAttachmentsHandler = handler(async (event) => {
  const auth = authenticate(event);
  const meetingId = getPathParameter(event, 'meetingId');
  const meeting = await getMeetingOrFail(meetingId);
  await requireGroupMembership(auth.userId, meeting.groupId);

  if (event.requestContext.http.method === 'GET') {
    return attachments.listByMeeting(meetingId);
  }

  if (event.requestContext.http.method === 'POST') {
    const input = parseBody(event, uploadAttachmentRequestSchema);
    if (input.meetingId !== meetingId) {
      throw new ApiError('BAD_REQUEST', 'meetingId phải khớp với path.', 400);
    }
    return attachments.createUploadTarget(meeting.groupId, input);
  }

  throw new ApiError('METHOD_NOT_ALLOWED', 'Phương thức chưa được hỗ trợ.', 405);
});

export const completeAttachmentUploadHandler = handler(async (event) => {
  if (event.requestContext.http.method !== 'POST') {
    throw new ApiError('METHOD_NOT_ALLOWED', 'Phương thức chưa được hỗ trợ.', 405);
  }
  const auth = authenticate(event);
  const meetingId = getPathParameter(event, 'meetingId');
  const meeting = await getMeetingOrFail(meetingId);
  await requireGroupMembership(auth.userId, meeting.groupId);

  const input = parseBody(event, completeUploadRequestSchema);
  const attachmentId = getPathParameter(event, 'attachmentId');
  if (input.attachmentId !== attachmentId) {
    throw new ApiError('BAD_REQUEST', 'attachmentId phải khớp với path.', 400);
  }
  return attachments.completeUpload(
    attachmentId,
    input.checksum,
    getRequestId(event),
    auth.userId,
  );
});

export const attachmentDownloadUrlHandler = handler(async (event) => {
  if (event.requestContext.http.method !== 'POST') {
    throw new ApiError('METHOD_NOT_ALLOWED', 'Phương thức chưa được hỗ trợ.', 405);
  }
  const auth = authenticate(event);
  const attachmentId = getPathParameter(event, 'attachmentId');
  const downloadTarget = await attachments.createDownloadTarget(attachmentId);
  const meeting = await getMeetingOrFail(downloadTarget.attachment.meetingId);
  await requireGroupMembership(auth.userId, meeting.groupId);
  return downloadTarget;
});
