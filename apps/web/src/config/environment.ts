export const environment = {
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL ?? '',
  appEnvironment: import.meta.env.VITE_APP_ENV ?? 'local',
} as const;

// VITE_* values are public build-time configuration and must never contain secrets.
