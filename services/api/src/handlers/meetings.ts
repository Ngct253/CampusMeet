import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import {
  GroupRole,
  cancelMeetingInputSchema,
  meetingInputSchema,
  updateMeetingInputSchema,
  type CreateMeetingRequest,
  type Meeting,
} from '@campusmeet/shared';
import { authenticate } from '../middleware/authentication';
import { requireGroupMembership } from '../middleware/authorization';
import { handleError } from '../middleware/error-handler';
import { DynamoDbCollaborationRepository } from '../repositories/collaboration';
import { DynamoDbMeetingRepository } from '../repositories/dynamodb';
import { ApiError, ResourceNotFoundError, UnprocessableEntityError } from '../utils/errors';
import { getPathParameter, getRequestId, parseBody, requireIdempotencyKey } from '../utils/request';
import { ok } from '../utils/response';

const meetings = new DynamoDbMeetingRepository();
const groups = new DynamoDbCollaborationRepository();

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

const getMeeting = async (meetingId: string) => {
  const meeting = await meetings.getById(meetingId);
  if (!meeting) throw new ResourceNotFoundError('Không tìm thấy cuộc họp.');
  return meeting;
};

const validateAttendees = async (groupId: string, attendeeIds: string[]) => {
  const uniqueIds = [...new Set(attendeeIds)];
  const memberships = await Promise.all(
    uniqueIds.map((userId) => groups.getMembership(groupId, userId)),
  );
  if (memberships.some((membership) => !membership)) {
    throw new UnprocessableEntityError('Người tham dự phải là thành viên đang hoạt động của nhóm.');
  }
  return uniqueIds;
};

const ensureValidPeriod = (startsAt: string, endsAt: string) => {
  if (Date.parse(endsAt) <= Date.parse(startsAt)) {
    throw new UnprocessableEntityError('Thời gian kết thúc phải sau thời gian bắt đầu.');
  }
};

export const groupMeetingsHandler = handler(async (event) => {
  const auth = authenticate(event);
  const groupId = getPathParameter(event, 'groupId');
  if (event.requestContext.http.method === 'GET') {
    await requireGroupMembership(auth.userId, groupId);
    return meetings.listByGroup(groupId);
  }
  if (event.requestContext.http.method === 'POST') {
    await requireGroupMembership(auth.userId, groupId, GroupRole.GROUP_ADMIN);
    const input = parseBody(event, meetingInputSchema) as CreateMeetingRequest;
    input.attendeeIds = await validateAttendees(groupId, [auth.userId, ...input.attendeeIds]);
    return meetings.create(groupId, auth.userId, input, requireIdempotencyKey(event));
  }
  throw new ApiError('METHOD_NOT_ALLOWED', 'Phương thức chưa được hỗ trợ.', 405);
});

export const myMeetingsHandler = handler(async (event) => {
  if (event.requestContext.http.method !== 'GET') {
    throw new ApiError('METHOD_NOT_ALLOWED', 'Phương thức chưa được hỗ trợ.', 405);
  }
  const auth = authenticate(event);
  const memberships = await groups.listForUser(auth.userId);
  const result = await Promise.all(memberships.map(({ id }) => meetings.listByGroup(id)));
  return result.flat().sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
});

export const meetingDetailHandler = handler(async (event) => {
  const auth = authenticate(event);
  const meeting = await getMeeting(getPathParameter(event, 'meetingId'));
  if (event.requestContext.http.method === 'GET') {
    await requireGroupMembership(auth.userId, meeting.groupId);
    return meeting;
  }
  if (event.requestContext.http.method === 'PATCH') {
    await requireGroupMembership(auth.userId, meeting.groupId, GroupRole.GROUP_ADMIN);
    const input = parseBody(event, updateMeetingInputSchema);
    const next: Meeting = {
      ...meeting,
      ...input,
      attendeeIds: input.attendeeIds
        ? await validateAttendees(meeting.groupId, [meeting.organizerId, ...input.attendeeIds])
        : meeting.attendeeIds,
    };
    ensureValidPeriod(next.startsAt, next.endsAt);
    return meetings.update(meeting.id, next);
  }
  throw new ApiError('METHOD_NOT_ALLOWED', 'Phương thức chưa được hỗ trợ.', 405);
});

export const cancelMeetingHandler = handler(async (event) => {
  if (event.requestContext.http.method !== 'POST') {
    throw new ApiError('METHOD_NOT_ALLOWED', 'Phương thức chưa được hỗ trợ.', 405);
  }
  const auth = authenticate(event);
  const meeting = await getMeeting(getPathParameter(event, 'meetingId'));
  await requireGroupMembership(auth.userId, meeting.groupId, GroupRole.GROUP_ADMIN);
  const { reason } = parseBody(event, cancelMeetingInputSchema);
  return meetings.cancel(meeting.id, reason);
});
