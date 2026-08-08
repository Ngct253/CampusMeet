import { createHash } from 'node:crypto';
import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import {
  cancelMeetingInputSchema,
  meetingInputSchema,
  updateMeetingInputSchema,
  type CreateMeetingRequest,
} from '@campusmeet/shared';
import { MeetingService } from '../application/meeting-service';
import { authenticate } from '../middleware/authentication';
import { SharedMembershipAuthorizer } from '../middleware/authorization';
import { handleError } from '../middleware/error-handler';
import { DynamoDbCollaborationRepository } from '../repositories/collaboration';
import { DynamoDbMeetingRepository } from '../repositories/dynamodb';
import { EventBridgeSchedulerAdapter } from '../integrations/adapters';
import { DynamoDbGoogleMeetingSyncRepository } from '../repositories/google-meeting-sync';
import { ApiError, BadRequestError } from '../utils/errors';
import { getPathParameter, getRequestId, parseBody, requireIdempotencyKey } from '../utils/request';
import { ok } from '../utils/response';

const service = new MeetingService(
  new DynamoDbMeetingRepository(),
  new SharedMembershipAuthorizer(),
  undefined,
  undefined,
  undefined,
  new EventBridgeSchedulerAdapter(),
  new DynamoDbGoogleMeetingSyncRepository(),
);
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

export const groupMeetingsHandler = handler(async (event) => {
  const auth = authenticate(event);
  const groupId = getPathParameter(event, 'groupId');
  if (event.requestContext.http.method === 'GET') {
    const rawLimit = event.queryStringParameters?.limit;
    const limit = rawLimit === undefined ? 20 : Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new BadRequestError('limit must be an integer from 1 to 100.');
    }
    return service.list(groupId, auth.userId, limit, event.queryStringParameters?.cursor);
  }
  if (event.requestContext.http.method === 'POST') {
    const input = parseBody(event, meetingInputSchema) as CreateMeetingRequest;
    const key = requireIdempotencyKey(event);
    const id = createHash('sha256')
      .update(auth.userId + ':' + key)
      .digest('hex')
      .slice(0, 32);
    try {
      return await service.create(groupId, auth.userId, input, id);
    } catch (error) {
      if ((error as { code?: string }).code === 'CONFLICT') {
        const existing = await service.getMeeting(id);
        if (existing?.groupId === groupId && existing.createdBy === auth.userId) return existing;
      }
      throw error;
    }
  }
  throw new ApiError('METHOD_NOT_ALLOWED', 'Phương thức chưa được hỗ trợ.', 405);
});

export const myMeetingsHandler = handler(async (event) => {
  if (event.requestContext.http.method !== 'GET') {
    throw new ApiError('METHOD_NOT_ALLOWED', 'Phương thức chưa được hỗ trợ.', 405);
  }
  const auth = authenticate(event);
  const memberships = await groups.listForUser(auth.userId);
  const result = await Promise.all(
    memberships.map(async ({ id }) => {
      const items = [];
      let cursor: string | undefined;
      const seen = new Set<string>();
      do {
        const page = await service.list(id, auth.userId, 100, cursor);
        items.push(...page.items);
        cursor = page.nextCursor;
        if (cursor && seen.has(cursor))
          throw new ApiError('INTERNAL_ERROR', 'Cursor repeated.', 500);
        if (cursor) seen.add(cursor);
      } while (cursor);
      return items;
    }),
  );
  return result.flat().sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
});

export const createMeetingDetailHandler = (meetingService: MeetingService) =>
  handler(async (event) => {
    const auth = authenticate(event);
    const meetingId = getPathParameter(event, 'meetingId');
    if (event.requestContext.http.method === 'GET')
      return meetingService.detail(meetingId, auth.userId);
    if (event.requestContext.http.method === 'PATCH') {
      return meetingService.update(
        meetingId,
        parseBody(event, updateMeetingInputSchema),
        auth.userId,
      );
    }
    throw new ApiError('METHOD_NOT_ALLOWED', 'Phương thức chưa được hỗ trợ.', 405);
  });
export const meetingDetailHandler = createMeetingDetailHandler(service);

export const createCancelMeetingHandler = (meetingService: MeetingService) =>
  handler(async (event) => {
    if (event.requestContext.http.method !== 'POST') {
      throw new ApiError('METHOD_NOT_ALLOWED', 'Phương thức chưa được hỗ trợ.', 405);
    }
    const auth = authenticate(event);
    const input = parseBody(event, cancelMeetingInputSchema);
    return meetingService.cancel(
      getPathParameter(event, 'meetingId'),
      auth.userId,
      input.reason,
      input.version,
    );
  });
export const cancelMeetingHandler = createCancelMeetingHandler(service);

export const createRetryGoogleSyncHandler = (meetingService: MeetingService) =>
  handler(async (event) => {
    if (event.requestContext.http.method !== 'POST') {
      throw new ApiError('METHOD_NOT_ALLOWED', 'Phương thức chưa được hỗ trợ.', 405);
    }
    const auth = authenticate(event);
    return meetingService.retryGoogleSync(getPathParameter(event, 'meetingId'), auth.userId);
  });
export const retryGoogleSyncHandler = createRetryGoogleSyncHandler(service);
