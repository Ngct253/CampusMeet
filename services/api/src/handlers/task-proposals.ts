import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { confirmTaskProposalInputSchema } from '@campusmeet/shared';
import { authenticate } from '../middleware/authentication';
import { handleError } from '../middleware/error-handler';
import { DynamoDbCollaborationRepository } from '../repositories/collaboration';
import { DynamoDbMeetingRepository } from '../repositories/dynamodb';
import { DynamoDbTaskProposalConfirmationRepository } from '../repositories/task-proposals';
import { TaskProposalConfirmationService } from '../services/task-proposal-confirmation-service';
import { getPathParameter, getRequestId, parseBody } from '../utils/request';
import { failure, ok } from '../utils/response';

type ConfirmationService = Pick<TaskProposalConfirmationService, 'confirm'>;

export const createTaskProposalConfirmationHandler =
  (service: ConfirmationService): APIGatewayProxyHandlerV2 =>
  async (event) => {
    const requestId = getRequestId(event);
    try {
      const { userId } = authenticate(event);
      if (event.requestContext.http.method !== 'POST') {
        return failure(requestId, 'Phương thức chưa được hỗ trợ.', 405, 'METHOD_NOT_ALLOWED');
      }
      return ok(
        await service.confirm(
          userId,
          getPathParameter(event, 'proposalId'),
          parseBody(event, confirmTaskProposalInputSchema),
        ),
        requestId,
      );
    } catch (error) {
      return handleError(error, requestId);
    }
  };

const service = new TaskProposalConfirmationService(
  new DynamoDbTaskProposalConfirmationRepository(),
  new DynamoDbMeetingRepository(),
  new DynamoDbCollaborationRepository(),
);

export const taskProposalConfirmationHandler = createTaskProposalConfirmationHandler(service);
