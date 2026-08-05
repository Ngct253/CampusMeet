export enum GroupRole {
  MEMBER = 'MEMBER',
  GROUP_ADMIN = 'GROUP_ADMIN',
}
export enum InvitationStatus {
  PENDING = 'PENDING',
  ACCEPTED = 'ACCEPTED',
  DECLINED = 'DECLINED',
  EXPIRED = 'EXPIRED',
  REVOKED = 'REVOKED',
}
export enum MeetingStatus {
  DRAFT = 'DRAFT',
  SCHEDULED = 'SCHEDULED',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}
export enum GoogleSyncStatus {
  NOT_REQUESTED = 'NOT_REQUESTED',
  PENDING = 'PENDING',
  READY = 'READY',
  FAILED_RETRYABLE = 'FAILED_RETRYABLE',
  ACTION_REQUIRED = 'ACTION_REQUIRED',
}
export enum TaskStatus {
  TODO = 'TODO',
  DOING = 'DOING',
  DONE = 'DONE',
}
export enum NotificationType {
  MEETING_REMINDER = 'MEETING_REMINDER',
  TASK_ASSIGNED = 'TASK_ASSIGNED',
  INVITATION = 'INVITATION',
  SYSTEM = 'SYSTEM',
}
export enum IntegrationStatus {
  NOT_CONNECTED = 'NOT_CONNECTED',
  PENDING = 'PENDING',
  READY = 'READY',
  FAILED = 'FAILED',
}
export enum Priority {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
}
