import { mockNotifications } from '../../mocks/data';
export const getMockNotifications = async () => ({
  success: true as const,
  isMock: true as const,
  requestId: 'mock-request',
  data: mockNotifications,
});
