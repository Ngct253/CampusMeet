export const environment = {
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL ?? '',
  userPoolId: import.meta.env.VITE_COGNITO_USER_POOL_ID ?? '',
  userPoolClientId: import.meta.env.VITE_COGNITO_USER_POOL_CLIENT_ID ?? '',
  capabilities: {
    ai: import.meta.env.VITE_ENABLE_AI === 'true',
    documentUpload: import.meta.env.VITE_ENABLE_DOCUMENT_UPLOAD !== 'false',
  },
} as const;

export const missingCognitoEnvironment = Object.entries({
  VITE_COGNITO_USER_POOL_ID: environment.userPoolId,
  VITE_COGNITO_USER_POOL_CLIENT_ID: environment.userPoolClientId,
})
  .filter(([, value]) => !value)
  .map(([name]) => name);

// VITE_* values are public build-time configuration and must never contain secrets.
