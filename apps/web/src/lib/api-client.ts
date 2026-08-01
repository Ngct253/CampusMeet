import { fetchAuthSession } from 'aws-amplify/auth';
import { environment } from '../config/environment';

export const apiClient = {
  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    if (!environment.apiBaseUrl)
      throw new Error('API CampusMeet chưa được cấu hình. Vui lòng thiết lập VITE_API_BASE_URL.');
    const token = (await fetchAuthSession()).tokens?.accessToken.toString();
    let response: Response;
    try {
      response = await fetch(environment.apiBaseUrl + path, {
        ...init,
        headers: {
          ...(init.body ? { 'content-type': 'application/json' } : {}),
          ...(token ? { Authorization: 'Bearer ' + token } : {}),
          ...init.headers,
        },
      });
    } catch (cause) {
      if (cause instanceof TypeError)
        throw new Error('Không thể kết nối tới CampusMeet. Vui lòng kiểm tra mạng rồi thử lại.');
      throw cause;
    }
    const payload: unknown = await response.json();
    if (!response.ok) {
      const message = typeof payload === 'object' && payload && 'error' in payload
        ? (payload as { error?: { message?: string } }).error?.message
        : undefined;
      throw new Error(message || `API CampusMeet trả lỗi ${response.status}.`);
    }
    return payload as T;
  },
};
