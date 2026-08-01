import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { dashboardHandler } from './handlers/dashboard';
import {
  groupDetailHandler,
  groupInvitationsHandler,
  groupMemberHandler,
  groupsHandler,
  revokeGroupInvitationHandler,
} from './handlers/groups';
import {
  acceptDirectInvitationHandler,
  acceptInvitationHandler,
  declineDirectInvitationHandler,
  declineInvitationHandler,
  invitationDetailsHandler,
  myInvitationsHandler,
} from './handlers/invitations';
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
import { notificationsHandler, readNotificationHandler } from './handlers/notifications';
import { tasksHandler } from './handlers/tasks';
import { getRequestId } from './utils/request';
import { notImplemented } from './utils/response';
import { createRouter } from './utils/router';

const findRoute = createRouter([
  { method: 'GET', path: '/health', handler: healthHandler },
  { method: 'ANY', path: '/me', handler: meHandler },
  { method: 'ANY', path: '/groups', handler: groupsHandler },
  { method: 'ANY', path: '/groups/:groupId', handler: groupDetailHandler },
  { method: 'POST', path: '/groups/:groupId/invitations', handler: groupInvitationsHandler },
  { method: 'GET', path: '/groups/:groupId/invitations', handler: groupInvitationsHandler },
  {
    method: 'POST',
    path: '/groups/:groupId/invitations/:invitationId/revoke',
    handler: revokeGroupInvitationHandler,
  },
  { method: 'DELETE', path: '/groups/:groupId/members/:userId', handler: groupMemberHandler },
  { method: 'GET', path: '/invitations', handler: myInvitationsHandler },
  {
    method: 'POST',
    path: '/invitations/by-id/:invitationId/accept',
    handler: acceptDirectInvitationHandler,
  },
  {
    method: 'POST',
    path: '/invitations/by-id/:invitationId/decline',
    handler: declineDirectInvitationHandler,
  },
  { method: 'GET', path: '/invitations/:token', handler: invitationDetailsHandler },
  { method: 'POST', path: '/invitations/:token/accept', handler: acceptInvitationHandler },
  { method: 'POST', path: '/invitations/:token/decline', handler: declineInvitationHandler },
  { method: 'ANY', path: '/meetings', handler: meetingsHandler },
  { method: 'ANY', path: '/minutes', handler: minutesHandler },
  { method: 'ANY', path: '/tasks', handler: tasksHandler },
  { method: 'ANY', path: '/dashboard', handler: dashboardHandler },
  { method: 'ANY', path: '/notifications', handler: notificationsHandler },
  { method: 'POST', path: '/notifications/:notificationId/read', handler: readNotificationHandler },
  { method: 'ANY', path: '/integrations', handler: integrationsHandler },
  { method: 'POST', path: '/meetings/:meetingId/ai/chat', handler: meetingChatHandler },
  { method: 'POST', path: '/groups/:groupId/ai/search', handler: groupSearchHandler },
  { method: 'POST', path: '/meetings/:meetingId/ai/minutes-draft', handler: minutesDraftHandler },
  { method: 'POST', path: '/meetings/:meetingId/ai/task-proposals', handler: taskProposalsHandler },
  {
    method: 'POST',
    path: '/groups/:groupId/ai/progress-analysis',
    handler: progressAnalysisHandler,
  },
]);

export const handler: APIGatewayProxyHandlerV2 = async (event, context, callback) => {
  const match = findRoute(event.requestContext.http.method, event.rawPath);
  if (!match) return notImplemented(getRequestId(event), 'Route');
  event.pathParameters = { ...event.pathParameters, ...match.pathParameters };
  const result = await match.handler(event, context, callback);
  return result ?? notImplemented(getRequestId(event), 'Route');
};

export { reminderHandler } from './handlers/reminder';
