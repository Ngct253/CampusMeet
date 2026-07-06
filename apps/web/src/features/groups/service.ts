import { mockGroups } from '../../mocks/data';
export const getMockGroups = async () => ({
  success: true as const,
  isMock: true as const,
  requestId: 'mock-request',
  data: mockGroups,
});
