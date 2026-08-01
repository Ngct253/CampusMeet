import { Navigate, createBrowserRouter } from 'react-router-dom';
import { DashboardPage } from '../features/dashboard/pages/DashboardPages';
import { GroupDetailPage, GroupsPage } from '../features/groups/pages/GroupPages';
import { GroupMeetingsPage, MeetingDetailPage } from '../features/meetings/pages/MeetingPages';
import { NotificationsPage } from '../features/notifications/pages/NotificationsPage';
import { SettingsPage } from '../features/settings/pages/SettingsPage';
import { TasksPage } from '../features/tasks/pages/TasksPage';
import { InvitationInboxPage, InvitationPage } from '../features/invitations/pages/InvitationPage';
import { RequireAuth } from '../auth/RequireAuth';
import { LandingPage } from '../pages/LandingPage';
import { NotFoundPage } from '../pages/NotFoundPage';
import {
  ConfirmSignUpPage,
  ForgotPasswordPage,
  SignInPage,
  SignUpPage,
} from '../pages/PublicPages';
export const router = createBrowserRouter([
  { path: '/', element: <LandingPage /> },
  { path: '/sign-in', element: <SignInPage /> },
  { path: '/sign-up', element: <SignUpPage /> },
  { path: '/confirm-sign-up', element: <ConfirmSignUpPage /> },
  { path: '/forgot-password', element: <ForgotPasswordPage /> },
  {
    path: '/app',
    element: <RequireAuth />,
    children: [
      { index: true, element: <Navigate to="dashboard" replace /> },
      { path: 'dashboard', element: <DashboardPage /> },
      { path: 'groups', element: <GroupsPage /> },
      { path: 'groups/:groupId', element: <GroupDetailPage /> },
      { path: 'groups/:groupId/meetings', element: <GroupMeetingsPage /> },
      { path: 'meetings/:meetingId', element: <MeetingDetailPage /> },
      { path: 'tasks', element: <TasksPage /> },
      { path: 'notifications', element: <NotificationsPage /> },
      { path: 'invitations', element: <InvitationInboxPage /> },
      { path: 'invitations/:token', element: <InvitationPage /> },
      { path: 'settings', element: <SettingsPage /> },
    ],
  },
  { path: '/dashboard', element: <Navigate to="/app/dashboard" replace /> },
  { path: '*', element: <NotFoundPage /> },
]);
