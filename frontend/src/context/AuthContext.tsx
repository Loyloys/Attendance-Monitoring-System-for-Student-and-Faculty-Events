/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { AuthService } from '../data/authService';
import type { GoogleAuthResult } from '../data/eventApi';
import type { AuthUser } from '../types/eventAttendance';

/** The two outcomes the server can return for a Google credential. */
type GoogleSignInOutcome = GoogleAuthResult;

interface AuthContextType {
  user: AuthUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  isOwner: (id: string) => boolean;
  login: (identifier: string, password: string) => Promise<AuthUser>;
  /** Verifies a Google credential. The server decides the outcome: an identity
   * that is already linked is signed in here, anything else resolves to
   * `profile_incomplete` and the caller continues to the profile step.
   *
   * The signed-in case also updates this context, which the route guards read.
   * Without that, a successful Google sign-in would immediately bounce back to
   * /login because `user` would still be null. */
  loginWithGoogle: (credential: string, selectedRole?: string) => Promise<GoogleSignInOutcome>;
  /** Re-reads the session from the server and mirrors it into this context. */
  refreshSession: () => Promise<AuthUser | null>;
  updateUser: (user: AuthUser) => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let active = true;
    AuthService.restoreSession()
      .then(restored => {
        if (active) setUser(restored);
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => { active = false; };
  }, []);

  const login = async (identifier: string, password: string) => {
    const authenticated = await AuthService.login({ email: identifier, password });
    setUser(authenticated);
    return authenticated;
  };

  // A Google identity that is not yet linked to an account has no session yet, so
  // this only settles the session for identities that map to an existing account.
  // `selectedRole` is forwarded purely so the server can explain a role mismatch;
  // it never assigns a role.
  const loginWithGoogle = useCallback(async (credential: string, selectedRole?: string): Promise<GoogleSignInOutcome> => {
    const result = await AuthService.googleAuthenticate(credential, selectedRole);
    // The signed-in case must land in this context, because the route guards read
    // `user` from here rather than from the service's cached copy.
    if (result.status === 'signed_in') setUser(result.user);
    return result;
  }, []);

  const refreshSession = useCallback(async () => {
    // Forced, so the new session is read back from the server rather than from
    // whatever the service happened to have cached.
    const restored = await AuthService.restoreSession({ force: true });
    setUser(restored);
    return restored;
  }, []);

  const logout = async () => {
    await AuthService.logout();
    setUser(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: Boolean(user),
        isOwner: (id: string) => user?.id === id,
        login,
        loginWithGoogle,
        refreshSession,
        updateUser: setUser,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};
