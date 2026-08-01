import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { dashboardHandler } from './handlers/dashboard';
import { groupsHandler, membershipsHandler } from './handlers/groups';
import { healthHandler } from './handlers/health';
import { integrationsHandler } from './handlers/integrations';
import {
  groupSearchHandler,
  meetingChatHandler,
  minutesDraftHandler,
  progressAnalysisHandler,
  taskProposalsHandler,
} from './ai/handlers';
import { meetingsHandler } from './handlers/meetings';
import { meHandler } from './handlers/me';
import { minutesHandler } from './handlers/minutes';
import { notificationsHandler } from './handlers/notifications';
import { tasksHandler } from './handlers/tasks';
import { getRequestId } from './utils/request';
import { notImplemented } from './utils/response';
import { createRouter } from './utils/router';

const findRoute = createRouter([
  { method: 'GET', path: '/health', handler: healthHandler },
  { method: 'GET', path: '/me', handler: meHandler },
  { method: 'ANY', path: '/groups', handler: groupsHandler },
  { method: 'ANY', path: '/memberships', handler: membershipsHandler },
  { method: 'ANY', path: '/meetings', handler: meetingsHandler },
  { method: 'ANY', path: '/minutes', handler: minutesHandler },
  { method: 'ANY', path: '/tasks', handler: tasksHandler },
  { method: 'ANY', path: '/dashboard', handler: dashboardHandler },
  { method: 'ANY', path: '/notifications', handler: notificationsHandler },
  { method: 'ANY', path: '/integrations', handler: integrationsHandler },
  { method: 'POST', path: '/meetings/:meetingId/ai/chat', handler: meetingChatHandler },
  { method: 'POST', path: '/groups/:groupId/ai/search', handler: groupSearchHandler },
  { method: 'POST', path: '/meetings/:meetingId/ai/minutes-draft', handler: minutesDraftHandler },
  { method: 'POST', path: '/meetings/:meetingId/ai/task-proposals', handler: taskProposalsHandler },
  { method: 'POST', path: '/groups/:groupId/ai/progress-analysis', handler: progressAnalysisHandler },
]);

export const handler: APIGatewayProxyHandlerV2 = async (event, context, callback) => {
  const match = findRoute(event.requestContext.http.method, event.rawPath);
  if (!match) return notImplemented(getRequestId(event), 'Route');
  event.pathParameters = { ...event.pathParameters, ...match.pathParameters };
  const result = await match.handler(event, context, callback);
  return result ?? notImplemented(getRequestId(event), 'Route');
};

export { reminderHandler } from './handlers/reminder';
