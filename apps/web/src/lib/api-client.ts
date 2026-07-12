import { fetchAuthSession } from 'aws-amplify/auth';
import { environment } from '../config/environment';

export const apiClient = {
  async request<T>(path: string): Promise<T> {
    if (!environment.apiBaseUrl)
      throw new Error('API CampusMeet chưa được cấu hình. Vui lòng thiết lập VITE_API_BASE_URL.');
    const token = (await fetchAuthSession()).tokens?.accessToken.toString();
    const response = await fetch(environment.apiBaseUrl + path, {
      headers: token ? { Authorization: 'Bearer ' + token } : {},
    });
    if (!response.ok) throw new Error('API request failed: ' + response.status);
    return response.json() as Promise<T>;
  },
};
