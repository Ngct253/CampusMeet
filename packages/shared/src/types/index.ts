import type {
  GroupRole,
  GoogleSyncStatus,
  GoogleMeetingFailureClass,
  GoogleMeetingSyncStatus,
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
export interface MeetingOrganizer {
  userId: string;
}
export interface AgendaItem {
  id: string;
  order: number;
  title: string;
  description?: string;
}
export interface Meeting {
  id: string;
  groupId: string;
  title: string;
  description?: string;
  organizerId: string;
  attendeeIds: string[];
  agenda: AgendaItem[];
  startsAt: ISODateTime;
  endsAt: ISODateTime;
  status: MeetingStatus;
  googleSyncStatus: GoogleSyncStatus;
  /** @deprecated Google synchronization state is exposed through googleSyncStatus. */
  integrationStatus: IntegrationStatus;
  googleEventId?: string;
  googleMeetingId?: string;
  meetUrl?: string;
  googleSync?: GoogleMeetingSyncSummary;
  createdAt: ISODateTime;
  createdBy: string;
  updatedAt: ISODateTime;
  updatedBy: string;
  version: number;
  cancelledAt?: ISODateTime;
  cancelledBy?: string;
  cancellationReason?: string;
}
export interface GoogleMeetingSyncRecord {
  meetingId: string;
  groupId: string;
  organizerId: string;
  provider: 'GOOGLE';
  syncStatus: GoogleMeetingSyncStatus;
  syncRevision: number;
  desiredMeetingVersion: number;
  desiredMeetingStatus: MeetingStatus;
  googleEventId?: string;
  meetUrl?: string;
  attemptCount: number;
  failureClass?: GoogleMeetingFailureClass;
  lastErrorCode?: string;
  lastErrorAt?: ISODateTime;
  nextRetryAt?: ISODateTime;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}
export interface GoogleMeetingSyncSummary {
  provider: 'GOOGLE';
  status: GoogleMeetingSyncStatus;
  meetUrl?: string;
  failureCode?: string;
  nextRetryAt?: ISODateTime;
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
  groupId: string;
  summary: string;
  discussion: string;
  decisions: Decision[];
  actionItems: ActionItem[];
  version: number;
  createdBy: string;
  createdAt: ISODateTime;
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
  sourceActionItemId?: string;
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
