import { Amplify } from 'aws-amplify';
import { environment, missingCognitoEnvironment } from './environment';

export const authConfigurationError = missingCognitoEnvironment.length
  ? import.meta.env.DEV
    ? 'Chưa kết nối môi trường AWS. Form hiện chỉ dùng để kiểm tra giao diện.'
    : 'Tính năng tài khoản hiện chưa khả dụng. Vui lòng thử lại sau.'
  : null;

export function configureAmplify() {
  if (authConfigurationError) {
    if (import.meta.env.DEV)
      console.warn('Thiếu cấu hình Cognito:', missingCognitoEnvironment.join(', '));
    return;
  }
  Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId: environment.userPoolId,
        userPoolClientId: environment.userPoolClientId,
      },
    },
  });
}
