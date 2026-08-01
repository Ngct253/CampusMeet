import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { healthHandler } from './handlers/health';
import { meHandler } from './handlers/me';
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
import { notificationsHandler, readNotificationHandler } from './handlers/notifications';
import { createRouter } from './utils/router';

const findRoute = createRouter([
  { method: 'GET', path: '/health', handler: healthHandler },
  { method: 'ANY', path: '/me', handler: meHandler },
  { method: 'ANY', path: '/groups', handler: groupsHandler },
  { method: 'ANY', path: '/groups/:groupId', handler: groupDetailHandler },
  { method: 'GET', path: '/groups/:groupId/invitations', handler: groupInvitationsHandler },
  { method: 'POST', path: '/groups/:groupId/invitations', handler: groupInvitationsHandler },
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
  { method: 'GET', path: '/notifications', handler: notificationsHandler },
  { method: 'POST', path: '/notifications/:notificationId/read', handler: readNotificationHandler },
]);

export const handler: APIGatewayProxyHandlerV2 = async (event, context, callback) => {
  if (event.requestContext.http.method === 'OPTIONS') return { statusCode: 204 };
  const match = findRoute(event.requestContext.http.method, event.rawPath);
  if (!match) return { statusCode: 404, body: JSON.stringify({ message: 'Not found' }) };
  event.pathParameters = { ...event.pathParameters, ...match.pathParameters };
  return (await match.handler(event, context, callback)) ?? { statusCode: 500 };
};
