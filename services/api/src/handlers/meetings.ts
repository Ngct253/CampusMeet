import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import {
  MeetingStatus,
  type CancelMeetingRequest,
  type CreateMeetingRequest,
  type UpdateMeetingRequest,
} from '@campusmeet/shared';
import { MeetingService } from '../application/meeting-service';
import { MeetingError } from '../domain/meeting-errors';
import { authenticate } from '../middleware/authentication';
import { DynamoDbMeetingRepository, DynamoDbMembershipAuthorizer } from '../repositories/dynamodb';
import { getRequestId } from '../utils/request';
import { created, failure, ok } from '../utils/response';
import { handleError } from '../middleware/error-handler';

const objectBody = (body?: string): Record<string, unknown> => {
  try {
    const value: unknown = body ? JSON.parse(body) : {};
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw new MeetingError('VALIDATION_ERROR', 'JSON body không hợp lệ.');
  }
};
const strings = (value: unknown, field: string) => {
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string'))
    throw new MeetingError('VALIDATION_ERROR', `${field} phải là mảng chuỗi.`);
  return value as string[];
};
const agenda = (value: unknown) => {
  if (!Array.isArray(value)) throw new MeetingError('VALIDATION_ERROR', 'agenda phải là mảng.');
  return value.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry))
      throw new MeetingError('VALIDATION_ERROR', 'Agenda item không hợp lệ.');
    const item = entry as Record<string, unknown>;
    if (typeof item.order !== 'number' || typeof item.title !== 'string')
      throw new MeetingError('VALIDATION_ERROR', 'Agenda cần order và title.');
    return {
      ...(typeof item.id === 'string' ? { id: item.id } : {}),
      order: item.order,
      title: item.title,
      ...(typeof item.description === 'string' ? { description: item.description } : {}),
    };
  });
};
const createInput = (body?: string): CreateMeetingRequest => {
  const v = objectBody(body);
  if (
    typeof v.groupId !== 'string' ||
    typeof v.title !== 'string' ||
    typeof v.organizerId !== 'string' ||
    typeof v.startsAt !== 'string' ||
    typeof v.endsAt !== 'string' ||
    (v.status !== MeetingStatus.DRAFT && v.status !== MeetingStatus.SCHEDULED)
  )
    throw new MeetingError('VALIDATION_ERROR', 'Thiếu hoặc sai trường create meeting bắt buộc.');
  return {
    groupId: v.groupId,
    title: v.title,
    organizerId: v.organizerId,
    attendeeIds: strings(v.attendeeIds, 'attendeeIds'),
    agenda: agenda(v.agenda),
    startsAt: v.startsAt,
    endsAt: v.endsAt,
    status: v.status,
    ...(typeof v.description === 'string' ? { description: v.description } : {}),
  };
};
const updateInput = (body?: string): UpdateMeetingRequest => {
  const v = objectBody(body);
  if (typeof v.version !== 'number')
    throw new MeetingError('VALIDATION_ERROR', 'version là bắt buộc.');
  return {
    version: v.version,
    ...(typeof v.title === 'string' ? { title: v.title } : {}),
    ...(typeof v.description === 'string' ? { description: v.description } : {}),
    ...(typeof v.organizerId === 'string' ? { organizerId: v.organizerId } : {}),
    ...(v.attendeeIds !== undefined ? { attendeeIds: strings(v.attendeeIds, 'attendeeIds') } : {}),
    ...(v.agenda !== undefined ? { agenda: agenda(v.agenda) } : {}),
    ...(typeof v.startsAt === 'string' ? { startsAt: v.startsAt } : {}),
    ...(typeof v.endsAt === 'string' ? { endsAt: v.endsAt } : {}),
    ...(v.status === MeetingStatus.DRAFT || v.status === MeetingStatus.SCHEDULED
      ? { status: v.status }
      : {}),
  };
};
const cancelInput = (body?: string): CancelMeetingRequest => {
  const v = objectBody(body);
  return {
    ...(typeof v.reason === 'string' ? { reason: v.reason } : {}),
    ...(typeof v.version === 'number' ? { version: v.version } : {}),
  };
};

export const createMeetingsHandler =
  (service: MeetingService): APIGatewayProxyHandlerV2 =>
  async (event) => {
    const requestId = getRequestId(event);
    try {
      const actor = authenticate(event).userId;
      const method = event.requestContext.http.method;
      const query = event.queryStringParameters ?? {};
      if (method === 'POST')
        return created(
          { meeting: await service.create(createInput(event.body), actor) },
          requestId,
        );
      if (method === 'GET' && query.meetingId) {
        const meeting = await service.detail(query.meetingId, actor);
        return ok(
          {
            meeting,
            organizer: { userId: meeting.organizerId },
            attendees: meeting.attendeeIds.map((userId) => ({ userId })),
            agenda: meeting.agenda,
          },
          requestId,
        );
      }
      if (method === 'GET' && query.groupId)
        return ok(
          await service.list(
            query.groupId,
            actor,
            query.limit ? Number(query.limit) : 20,
            query.cursor,
          ),
          requestId,
        );
      if (method === 'PATCH' && query.meetingId)
        return ok(
          { meeting: await service.update(query.meetingId, updateInput(event.body), actor) },
          requestId,
        );
      if (method === 'DELETE' && query.meetingId) {
        const input = cancelInput(event.body);
        return ok(
          { meeting: await service.cancel(query.meetingId, actor, input.reason, input.version) },
          requestId,
        );
      }
      throw new MeetingError(
        'VALIDATION_ERROR',
        'Thiếu meetingId hoặc groupId phù hợp với operation.',
      );
    } catch (error) {
      if (error instanceof MeetingError)
        return failure(requestId, error.message, error.statusCode, error.code);
      if (error instanceof Error && 'statusCode' in error) {
        const typed = error as Error & { statusCode: number; code: string };
        return failure(requestId, typed.message, typed.statusCode, typed.code);
      }
      return handleError(error, requestId);
    }
  };
let singleton: APIGatewayProxyHandlerV2 | undefined;
export const meetingsHandler: APIGatewayProxyHandlerV2 = (event, context, callback) => {
  singleton ??= createMeetingsHandler(
    new MeetingService(new DynamoDbMeetingRepository(), new DynamoDbMembershipAuthorizer()),
  );
  return singleton(event, context, callback);
};
