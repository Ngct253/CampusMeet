import { getCurrentUser, signOut, type GetCurrentUserOutput } from 'aws-amplify/auth';
import { Hub } from 'aws-amplify/utils';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { authConfigurationError } from '../config/amplify';

type AuthState =
  | { status: 'loading'; user: null; error: null }
  | { status: 'authenticated'; user: GetCurrentUserOutput; error: null }
  | { status: 'unauthenticated'; user: null; error: null }
  | { status: 'configuration-error'; user: null; error: string };
type AuthContextValue = AuthState & {
  refreshAuth: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>(authConfigurationError
      ? { status: 'configuration-error', user: null, error: authConfigurationError }
    : { status: 'loading', user: null, error: null });
  const refreshAuth = useCallback(async () => {
    if (authConfigurationError) return;
    try {
      setState({ status: 'authenticated', user: await getCurrentUser(), error: null });
    } catch {
      setState({ status: 'unauthenticated', user: null, error: null });
    }
  }, []);

  useEffect(() => {
    void refreshAuth();
    return Hub.listen('auth', ({ payload }) => {
      if (['signedIn', 'signedOut', 'tokenRefresh', 'tokenRefresh_failure'].includes(payload.event)) void refreshAuth();
    });
  }, [refreshAuth]);

  const value = useMemo<AuthContextValue>(() => ({
    ...state,
    refreshAuth,
    signOut: async () => {
      try {
        await signOut({ global: false });
      } finally {
        window.location.assign('/');
      }
    },
  }), [refreshAuth, state]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth phải được dùng bên trong AuthProvider.');
  return value;
}
