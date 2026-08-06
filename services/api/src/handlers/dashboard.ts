import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { authenticate } from '../middleware/authentication';
import { handleError } from '../middleware/error-handler';
import { DynamoDbTaskRepository } from '../repositories/tasks';
import { DashboardService } from '../services/dashboard-service';
import { getRequestId } from '../utils/request';
import { failure, ok } from '../utils/response';

type DashboardReader = Pick<DashboardService, 'getPersonalTaskSummary'>;

export const createDashboardHandler = (
  dashboard: DashboardReader,
): APIGatewayProxyHandlerV2 => async (event) => {
  const requestId = getRequestId(event);
  try {
    const { userId } = authenticate(event);
    if (event.requestContext.http.method !== 'GET') {
      return failure(requestId, 'Phương thức chưa được hỗ trợ.', 405, 'METHOD_NOT_ALLOWED');
    }
    return ok(await dashboard.getPersonalTaskSummary(userId), requestId);
  } catch (error) {
    return handleError(error, requestId);
  }
};

export const dashboardHandler = createDashboardHandler(
  new DashboardService(new DynamoDbTaskRepository()),
);
