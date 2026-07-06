import { mockTasks } from '../../mocks/data';
export const getMockTasks = async () => ({
  success: true as const,
  isMock: true as const,
  requestId: 'mock-request',
  data: mockTasks,
});
