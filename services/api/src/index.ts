import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { dashboardHandler } from './handlers/dashboard';
import { aiJobDetailHandler } from './handlers/ai-jobs';
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
import {
  attachmentDownloadUrlHandler,
  completeAttachmentUploadHandler,
  meetingAttachmentsHandler,
} from './handlers/attachments';
import { googleOAuthCallbackHandler, integrationsHandler } from './handlers/integrations';
import {
  groupSearchHandler,
  meetingChatHandler,
  minutesDraftHandler,
  progressAnalysisHandler,
  taskProposalsHandler,
} from './ai/handlers';
import {
  cancelMeetingHandler,
  groupMeetingsHandler,
  meetingDetailHandler,
  myMeetingsHandler,
  retryGoogleSyncHandler,
} from './handlers/meetings';
import { meHandler } from './handlers/me';
import { minutesHandler } from './handlers/minutes';
import { actionItemTaskHandler } from './handlers/action-item-tasks';
import { notificationsHandler, readNotificationHandler } from './handlers/notifications';
import { meetContextHandler } from './handlers/meet-context';
import { tasksHandler, taskStatusHandler } from './handlers/tasks';
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
  { method: 'GET', path: '/groups/:groupId/meetings', handler: groupMeetingsHandler },
  { method: 'POST', path: '/groups/:groupId/meetings', handler: groupMeetingsHandler },
  { method: 'GET', path: '/meetings', handler: myMeetingsHandler },
  { method: 'ANY', path: '/meetings/:meetingId', handler: meetingDetailHandler },
  { method: 'POST', path: '/meetings/:meetingId/cancel', handler: cancelMeetingHandler },
  {
    method: 'POST',
    path: '/meetings/:meetingId/google-sync/retry',
    handler: retryGoogleSyncHandler,
  },
  { method: 'GET', path: '/meetings/:meetingId/attachments', handler: meetingAttachmentsHandler },
  {
    method: 'POST',
    path: '/meetings/:meetingId/attachments/upload-url',
    handler: meetingAttachmentsHandler,
  },
  {
    method: 'POST',
    path: '/meetings/:meetingId/attachments/:attachmentId/complete',
    handler: completeAttachmentUploadHandler,
  },
  {
    method: 'POST',
    path: '/attachments/:attachmentId/download-url',
    handler: attachmentDownloadUrlHandler,
  },
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
  { method: 'GET', path: '/meetings/:meetingId/minutes', handler: minutesHandler },
  { method: 'PUT', path: '/meetings/:meetingId/minutes', handler: minutesHandler },
  {
    method: 'POST',
    path: '/meetings/:meetingId/minutes/action-items/:actionItemId/task',
    handler: actionItemTaskHandler,
  },
  { method: 'GET', path: '/tasks', handler: tasksHandler },
  { method: 'POST', path: '/tasks', handler: tasksHandler },
  { method: 'PATCH', path: '/tasks/:taskId/status', handler: taskStatusHandler },
  { method: 'GET', path: '/dashboard', handler: dashboardHandler },
  { method: 'ANY', path: '/notifications', handler: notificationsHandler },
  { method: 'POST', path: '/notifications/:notificationId/read', handler: readNotificationHandler },
  { method: 'POST', path: '/integrations/google/connect', handler: integrationsHandler },
  { method: 'GET', path: '/integrations/google/callback', handler: googleOAuthCallbackHandler },
  { method: 'GET', path: '/integrations/google/meet-context', handler: meetContextHandler },
  { method: 'POST', path: '/meetings/:meetingId/ai/chat', handler: meetingChatHandler },
  { method: 'POST', path: '/groups/:groupId/ai/search', handler: groupSearchHandler },
  { method: 'POST', path: '/meetings/:meetingId/ai/minutes-draft', handler: minutesDraftHandler },
  { method: 'POST', path: '/meetings/:meetingId/ai/task-proposals', handler: taskProposalsHandler },
  {
    method: 'POST',
    path: '/groups/:groupId/ai/progress-analysis',
    handler: progressAnalysisHandler,
  },
  { method: 'GET', path: '/ai/jobs/:aiJobId', handler: aiJobDetailHandler },
]);

export const handler: APIGatewayProxyHandlerV2 = async (event, context, callback) => {
  if (event.requestContext.http.method === 'OPTIONS') {
    return { statusCode: 204 };
  }
  const stage = event.requestContext.stage;
  const stagePrefix = `/${stage}`;
  const rawPath =
    stage !== '$default' &&
    (event.rawPath === stagePrefix || event.rawPath.startsWith(`${stagePrefix}/`))
      ? event.rawPath.slice(stagePrefix.length) || '/'
      : event.rawPath;
  const match = findRoute(event.requestContext.http.method, rawPath);
  if (!match) return notImplemented(getRequestId(event), 'Route');
  event.pathParameters = { ...event.pathParameters, ...match.pathParameters };
  const result = await match.handler(event, context, callback);
  return result ?? notImplemented(getRequestId(event), 'Route');
};

export { reminderHandler } from './handlers/reminder';
export { googleSyncWorkerHandler } from './handlers/google-sync-worker';
