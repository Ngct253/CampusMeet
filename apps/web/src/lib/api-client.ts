import { fetchAuthSession } from 'aws-amplify/auth';
import type { ApiErrorResponse } from '@campusmeet/shared';
import { environment } from '../config/environment';

export class ApiClientError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

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
      const apiError =
        typeof payload === 'object' &&
        payload !== null &&
        'success' in payload &&
        payload.success === false &&
        'error' in payload
          ? (payload as ApiErrorResponse).error
          : undefined;
      throw new ApiClientError(
        apiError?.message || `API CampusMeet trả lỗi ${response.status}.`,
        response.status,
        apiError?.code || 'HTTP_ERROR',
        apiError?.details,
      );
    }
    return payload as T;
  },
};
