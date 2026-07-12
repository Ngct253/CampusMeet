import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { dashboardHandler } from './handlers/dashboard';
import { groupsHandler, membershipsHandler } from './handlers/groups';
import { healthHandler } from './handlers/health';
import { integrationsHandler } from './handlers/integrations';
import { meetingsHandler } from './handlers/meetings';
import { meHandler } from './handlers/me';
import { minutesHandler } from './handlers/minutes';
import { notificationsHandler } from './handlers/notifications';
import { tasksHandler } from './handlers/tasks';
import { getRequestId } from './utils/request';
import { notImplemented } from './utils/response';

const routes: Record<string, APIGatewayProxyHandlerV2> = {
  'GET /health': healthHandler,
  'GET /me': meHandler,
  'ANY /groups': groupsHandler,
  'ANY /memberships': membershipsHandler,
  'ANY /meetings': meetingsHandler,
  'ANY /minutes': minutesHandler,
  'ANY /tasks': tasksHandler,
  'ANY /dashboard': dashboardHandler,
  'ANY /notifications': notificationsHandler,
  'ANY /integrations': integrationsHandler,
};

export const handler: APIGatewayProxyHandlerV2 = async (event, context, callback) => {
  const key = `${event.requestContext.http.method} ${event.rawPath}`;
  const route = routes[key] ?? routes[`ANY ${event.rawPath}`];
  if (!route) return notImplemented(getRequestId(event), 'Route');
  const result = await route(event, context, callback);
  return result ?? notImplemented(getRequestId(event), 'Route');
};

export { reminderHandler } from './handlers/reminder';
