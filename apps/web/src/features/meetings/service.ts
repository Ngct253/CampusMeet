import { mockMeetings } from '../../mocks/data';
export const getMockMeetings = async () => ({
  success: true as const,
  isMock: true as const,
  requestId: 'mock-request',
  data: mockMeetings,
});
