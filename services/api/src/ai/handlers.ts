import type { APIGatewayProxyEventV2, APIGatewayProxyHandlerV2 } from 'aws-lambda';
import {
  generateMeetingDraftRequestSchema,
  groupKnowledgeQuerySchema,
  groupProgressAnalysisRequestSchema,
  meetingChatRequestSchema,
} from '@campusmeet/shared';
import { authenticate } from '../middleware/authentication';
import { handleError } from '../middleware/error-handler';
import { getPathParameter, getRequestId, parseBody, requireIdempotencyKey } from '../utils/request';
import { accepted } from '../utils/response';
import { createProductionAIRequestServiceAdapters } from './aws-adapters';
import { AIRequestService } from './request-service';

let productionService: AIRequestService | undefined;
const getProductionService = () => {
  if (!productionService) {
    const adapters = createProductionAIRequestServiceAdapters();
    productionService = new AIRequestService(adapters.access, adapters.meetings, adapters.jobs);
  }
  return productionService;
};

export const createAIHandlers = (getService: () => AIRequestService) => {
  const handler =
    <TInput>(
      parseInput: (event: APIGatewayProxyEventV2, requestId: string) => TInput,
      action: (service: AIRequestService, input: TInput) => Promise<unknown>,
    ): APIGatewayProxyHandlerV2 =>
    async (event) => {
      const requestId = getRequestId(event);
      try {
        const input = parseInput(event, requestId);
        return accepted(await action(getService(), input), requestId);
      } catch (error) {
        return handleError(error, requestId);
      }
    };

  return {
    meetingChatHandler: handler(
      (event, requestId) => ({
        actorId: authenticate(event).userId,
        meetingId: getPathParameter(event, 'meetingId'),
        request: parseBody(event, meetingChatRequestSchema),
        idempotencyKey: requireIdempotencyKey(event),
        requestId,
      }),
      (ai, input) => ai.requestMeetingChat(input),
    ),
    groupSearchHandler: handler(
      (event, requestId) => ({
        actorId: authenticate(event).userId,
        groupId: getPathParameter(event, 'groupId'),
        request: parseBody(event, groupKnowledgeQuerySchema),
        idempotencyKey: requireIdempotencyKey(event),
        requestId,
      }),
      (ai, input) => ai.requestGroupSearch(input),
    ),
    minutesDraftHandler: handler(
      (event, requestId) => ({
        actorId: authenticate(event).userId,
        meetingId: getPathParameter(event, 'meetingId'),
        request: parseBody(event, generateMeetingDraftRequestSchema),
        idempotencyKey: requireIdempotencyKey(event),
        requestId,
      }),
      (ai, input) => ai.requestMinutesDraft(input),
    ),
    taskProposalsHandler: handler(
      (event, requestId) => ({
        actorId: authenticate(event).userId,
        meetingId: getPathParameter(event, 'meetingId'),
        request: parseBody(event, generateMeetingDraftRequestSchema),
        idempotencyKey: requireIdempotencyKey(event),
        requestId,
      }),
      (ai, input) => ai.requestTaskProposals(input),
    ),
    progressAnalysisHandler: handler(
      (event, requestId) => ({
        actorId: authenticate(event).userId,
        groupId: getPathParameter(event, 'groupId'),
        request: parseBody(event, groupProgressAnalysisRequestSchema),
        idempotencyKey: requireIdempotencyKey(event),
        requestId,
      }),
      (ai, input) => ai.requestProgressAnalysis(input),
    ),
  };
};

export const {
  meetingChatHandler,
  groupSearchHandler,
  minutesDraftHandler,
  taskProposalsHandler,
  progressAnalysisHandler,
} = createAIHandlers(getProductionService);
