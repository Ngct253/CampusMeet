import {
  GroupRole,
  IntegrationStatus,
  GoogleSyncStatus,
  MeetingStatus,
  NotificationType,
  Priority,
  TaskStatus,
  type Group,
  type Meeting,
  type Notification,
  type Task,
  type User,
} from '@campusmeet/shared';

// MOCK DATA: chỉ dùng để render bố cục, không đại diện dữ liệu production.
export const mockUser: User = {
  id: 'user-1',
  email: 'lan@example.edu',
  displayName: 'Nguyễn Minh Lan',
  timezone: 'Asia/Ho_Chi_Minh',
};
export const mockGroups: Group[] = [
  {
    id: 'group-1',
    name: 'Đồ án Cloud Computing',
    description: `Vai trò: ${GroupRole.GROUP_ADMIN}`,
    createdBy: 'user-1',
    createdAt: '2026-07-01T01:00:00Z',
  },
];
export const mockMeetings: Meeting[] = [
  {
    id: 'meeting-1',
    groupId: 'group-1',
    title: 'Họp lập kế hoạch Sprint 1',
    organizerId: 'user-1',
    attendeeIds: ['user-1'],
    agenda: [],
    startsAt: '2026-07-08T02:00:00Z',
    endsAt: '2026-07-08T03:00:00Z',
    status: MeetingStatus.SCHEDULED,
    integrationStatus: IntegrationStatus.PENDING,
    googleSyncStatus: GoogleSyncStatus.PENDING,
    createdAt: '2026-07-01T01:00:00Z',
    createdBy: 'user-1',
    updatedAt: '2026-07-01T01:00:00Z',
    updatedBy: 'user-1',
    version: 1,
  },
];
export const mockTasks: Task[] = [
  {
    id: 'task-1',
    groupId: 'group-1',
    title: 'Hoàn thiện wireframe',
    assigneeId: 'user-1',
    status: TaskStatus.DOING,
    priority: Priority.HIGH,
    dueAt: '2026-07-10T10:00:00Z',
  },
];
export const mockNotifications: Notification[] = [
  {
    id: 'notification-1',
    userId: 'user-1',
    type: NotificationType.MEETING_REMINDER,
    title: 'Cuộc họp bắt đầu sau 2 ngày',
    read: false,
    createdAt: '2026-07-06T02:00:00Z',
  },
];
