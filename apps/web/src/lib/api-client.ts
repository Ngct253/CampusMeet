export class NotImplementedError extends Error {}

export const apiClient = {
  async request<T>(_path: string): Promise<T> {
    // TODO(M1/M3): connect this boundary only after authentication and the API contract are implemented.
    throw new NotImplementedError('API thật chưa được kết nối; ứng dụng đang dùng mock data.');
  },
};
