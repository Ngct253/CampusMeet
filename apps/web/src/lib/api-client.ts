import { fetchAuthSession } from 'aws-amplify/auth';
import { environment } from '../config/environment';

export const apiClient = {
  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    if (!environment.apiBaseUrl)
      throw new Error('API CampusMeet chưa được cấu hình. Vui lòng thiết lập VITE_API_BASE_URL.');
    const token = (await fetchAuthSession()).tokens?.accessToken.toString();
    const response = await fetch(environment.apiBaseUrl + path, {
      ...init,
      headers: {
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...init.headers,
      },
    });
    if (!response.ok) {
      const body: unknown = await response.json().catch(() => undefined);
      const message =
        body &&
        typeof body === 'object' &&
        'error' in body &&
        body.error &&
        typeof body.error === 'object' &&
        'message' in body.error
          ? String(body.error.message)
          : `API request failed: ${response.status}`;
      throw new Error(message);
    }
    return response.json() as Promise<T>;
  },
};
