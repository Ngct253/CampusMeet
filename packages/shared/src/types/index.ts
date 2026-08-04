import type {
  GroupRole,
  IntegrationStatus,
  InvitationStatus,
  MeetingStatus,
  NotificationType,
  Priority,
  TaskStatus,
} from '../enums';

export type ISODateTime = string;

export interface User {
  id: string;
  email: string;
  displayName: string;
  timezone: string;
  avatarUrl?: string;
}
export interface UserProfile extends User {
  emailNotificationsEnabled: boolean;
}
export interface Group {
  id: string;
  name: string;
  description?: string;
  createdBy: string;
  createdAt: ISODateTime;
}
export interface GroupSummary extends Group {
  role: GroupRole;
  joinedAt: ISODateTime;
}
export interface GroupMember {
  membership: Membership;
  user?: Pick<User, 'id' | 'email' | 'displayName'>;
}
export interface GroupDetails {
  group: GroupSummary;
  members: GroupMember[];
}
export interface Membership {
  id: string;
  groupId: string;
  userId: string;
  role: GroupRole;
  active: boolean;
  joinedAt: ISODateTime;
}
export interface Invitation {
  id: string;
  groupId: string;
  email: string;
  status: InvitationStatus;
  expiresAt: ISODateTime;
}
export interface InvitationDetails extends Invitation {
  groupName: string;
  createdAt: ISODateTime;
}
export interface MeetingAttendee {
  userId: string;
  response?: 'PENDING' | 'ACCEPTED' | 'DECLINED';
}
export interface Meeting {
  id: string;
  groupId: string;
  title: string;
  description?: string;
  organizerId: string;
  attendeeIds: string[];
  startsAt: ISODateTime;
  endsAt: ISODateTime;
  status: MeetingStatus;
  integrationStatus: IntegrationStatus;
  meetUrl?: string;
}
export interface Reminder {
  id: string;
  meetingId: string;
  scheduledAt: ISODateTime;
  sentAt?: ISODateTime;
}
export interface Decision {
  id: string;
  content: string;
}
export interface ActionItem {
  id: string;
  content: string;
  assigneeId?: string;
  dueAt?: ISODateTime;
  taskId?: string;
}
export interface MeetingMinutes {
  id: string;
  meetingId: string;
  summary: string;
  decisions: Decision[];
  actionItems: ActionItem[];
}
export interface Task {
  id: string;
  groupId: string;
  title: string;
  assigneeId: string;
  status: TaskStatus;
  priority: Priority;
  dueAt?: ISODateTime;
  sourceMeetingId?: string;
  createdBy?: string;
  createdAt?: ISODateTime;
  updatedAt?: ISODateTime;
  completedAt?: ISODateTime;
  version?: number;
}
export interface Notification {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  read: boolean;
  createdAt: ISODateTime;
  actionUrl?: string;
}
export interface AuditLog {
  id: string;
  actorId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  occurredAt: ISODateTime;
  requestId: string;
}
