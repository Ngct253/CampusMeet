import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from './api-client';

const fetchAuthSession = vi.hoisted(() => vi.fn());
const environment = vi.hoisted(() => ({ apiBaseUrl: '' }));
vi.mock('aws-amplify/auth', () => ({ fetchAuthSession }));
vi.mock('../config/environment', () => ({ environment }));

describe('apiClient', () => {
  beforeEach(() => {
    environment.apiBaseUrl = '';
    fetchAuthSession.mockReset();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('báo lỗi cấu hình trước khi gọi auth hoặc network khi thiếu API URL', async () => {
    await expect(apiClient.request('/me')).rejects.toThrow(
      'API CampusMeet chưa được cấu hình. Vui lòng thiết lập VITE_API_BASE_URL.',
    );
    expect(fetchAuthSession).not.toHaveBeenCalled();
  });

  it('đổi lỗi network kỹ thuật thành hướng dẫn tiếng Việt', async () => {
    environment.apiBaseUrl = 'https://api.example.test';
    fetchAuthSession.mockResolvedValue({ tokens: { accessToken: { toString: () => 'token' } } });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    await expect(apiClient.request('/groups')).rejects.toThrow(
      'Không thể kết nối tới CampusMeet. Vui lòng kiểm tra mạng rồi thử lại.',
    );
  });
});
