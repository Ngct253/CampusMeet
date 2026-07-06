import type { ApiSuccessResponse, DashboardResponse } from '@campusmeet/shared';
import { mockGroups, mockMeetings, mockNotifications, mockTasks, mockUser } from '../../mocks/data';

export async function getMockDashboard(): Promise<ApiSuccessResponse<DashboardResponse>> {
  return {
    success: true,
    requestId: 'mock-request',
    isMock: true,
    data: {
      user: mockUser,
      groups: mockGroups,
      upcomingMeetings: mockMeetings,
      tasks: mockTasks,
      notifications: mockNotifications,
    },
  };
}
