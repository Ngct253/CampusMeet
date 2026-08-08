import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { confirmTaskProposalRequestSchema } from '@campusmeet/shared';
import { authenticate } from '../middleware/authentication';
import { handleError } from '../middleware/error-handler';
import { DynamoDbTaskProposalConfirmationRepository } from '../repositories/task-proposals';
import { TaskProposalConfirmationService } from '../services/task-proposal-confirmation-service';
import { taskRepository, taskService } from './tasks';
import { getPathParameter, getRequestId, parseBody, requireIdempotencyKey } from '../utils/request';
import { failure, ok } from '../utils/response';

const confirmationService = new TaskProposalConfirmationService(
  new DynamoDbTaskProposalConfirmationRepository(),
  taskService,
  taskRepository,
);

export const createConfirmTaskProposalHandler = (
  service: Pick<TaskProposalConfirmationService, 'confirm'>,
): APIGatewayProxyHandlerV2 => async (event) => {
  const requestId = getRequestId(event);
  try {
    if (event.requestContext.http.method !== 'POST') {
      return failure(requestId, 'Phương thức chưa được hỗ trợ.', 405, 'METHOD_NOT_ALLOWED');
    }
    const { userId } = authenticate(event);
    return ok(
      await service.confirm(
        userId,
        getPathParameter(event, 'proposalId'),
        parseBody(event, confirmTaskProposalRequestSchema),
        requireIdempotencyKey(event),
      ),
      requestId,
    );
  } catch (error) {
    return handleError(error, requestId);
  }
};

export const confirmTaskProposalHandler = createConfirmTaskProposalHandler(confirmationService);
