import type { APIGatewayProxyEventV2, APIGatewayProxyHandlerV2 } from 'aws-lambda';
import {
  generateMeetingDraftRequestSchema,
  groupKnowledgeQuerySchema,
  groupProgressAnalysisRequestSchema,
  meetingChatRequestSchema,
} from '@campusmeet/shared';
import type { MeetingChatRequest } from '@campusmeet/shared';
import { handleError } from '../middleware/error-handler';
import { UnauthorizedError } from '../utils/errors';
import { getPathParameter, getRequestId, parseBody, requireIdempotencyKey } from '../utils/request';
import { accepted } from '../utils/response';
import { createProductionAIRequestServiceAdapters } from './aws-adapters';
import { AIRequestService } from './request-service';

const actorId = (event: APIGatewayProxyEventV2): string => {
  const requestContext = event.requestContext as typeof event.requestContext & {
    authorizer?: { jwt?: { claims?: Record<string, unknown> } };
  };
  const sub = requestContext.authorizer?.jwt?.claims?.sub;
  if (typeof sub !== 'string' || !sub) throw new UnauthorizedError();
  return sub;
};

let service: AIRequestService | undefined;
const getService = () => {
  if (!service) {
    const adapters = createProductionAIRequestServiceAdapters();
    service = new AIRequestService(adapters.access, adapters.meetings, adapters.jobs);
  }
  return service;
};

const handler = (
  action: (service: AIRequestService, event: APIGatewayProxyEventV2, requestId: string) => Promise<unknown>,
): APIGatewayProxyHandlerV2 =>
  async (event) => {
    const requestId = getRequestId(event);
    try {
      return accepted(await action(getService(), event, requestId), requestId);
    } catch (error) {
      return handleError(error, requestId);
    }
  };

export const meetingChatHandler = handler((ai, event, requestId) =>
  ai.requestMeetingChat({
    actorId: actorId(event),
    meetingId: getPathParameter(event, 'meetingId'),
    request: parseBody<MeetingChatRequest>(event, meetingChatRequestSchema),
    idempotencyKey: requireIdempotencyKey(event),
    requestId,
  }),
);

export const groupSearchHandler = handler((ai, event, requestId) =>
  ai.requestGroupSearch({
    actorId: actorId(event),
    groupId: getPathParameter(event, 'groupId'),
    request: parseBody(event, groupKnowledgeQuerySchema),
    idempotencyKey: requireIdempotencyKey(event),
    requestId,
  }),
);

export const minutesDraftHandler = handler((ai, event, requestId) =>
  ai.requestMinutesDraft({
    actorId: actorId(event),
    meetingId: getPathParameter(event, 'meetingId'),
    request: parseBody(event, generateMeetingDraftRequestSchema),
    idempotencyKey: requireIdempotencyKey(event),
    requestId,
  }),
);

export const taskProposalsHandler = handler((ai, event, requestId) =>
  ai.requestTaskProposals({
    actorId: actorId(event),
    meetingId: getPathParameter(event, 'meetingId'),
    request: parseBody(event, generateMeetingDraftRequestSchema),
    idempotencyKey: requireIdempotencyKey(event),
    requestId,
  }),
);

export const progressAnalysisHandler = handler((ai, event, requestId) =>
  ai.requestProgressAnalysis({
    actorId: actorId(event),
    groupId: getPathParameter(event, 'groupId'),
    request: parseBody(event, groupProgressAnalysisRequestSchema),
    idempotencyKey: requireIdempotencyKey(event),
    requestId,
  }),
);
