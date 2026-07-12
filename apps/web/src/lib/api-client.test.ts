import { describe, expect, it, vi } from 'vitest';
import { apiClient } from './api-client';

const fetchAuthSession = vi.hoisted(() => vi.fn());
vi.mock('aws-amplify/auth', () => ({ fetchAuthSession }));
vi.mock('../config/environment', () => ({ environment: { apiBaseUrl: '' } }));

describe('apiClient', () => {
  it('báo lỗi cấu hình trước khi gọi auth hoặc network khi thiếu API URL', async () => {
    await expect(apiClient.request('/me')).rejects.toThrow(
      'API CampusMeet chưa được cấu hình. Vui lòng thiết lập VITE_API_BASE_URL.',
    );
    expect(fetchAuthSession).not.toHaveBeenCalled();
  });
});
