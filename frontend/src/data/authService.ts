import { ApiError, eventApi } from './eventApi';
import type { GoogleAuthResult, GoogleConfig, GoogleSession } from './eventApi';
import type { AuthUser, UserRole } from '../types/eventAttendance';

export type UserType = UserRole | 'lecturer';
export type { AuthUser };

export interface LoginCredentials {
  email: string;
  password: string;
  userType?: UserType;
  recaptchaToken?: string;
}

export const normalizeUserType = (userType?: string): UserType => {
  if (userType === 'faculty' || userType === 'lecturer') return 'faculty';
  if (userType === 'admin') return 'admin';
  return 'student';
};

let activeUser: AuthUser | null = null;

export const getCurrentUser = (): AuthUser | null => activeUser;

// Authentication service

export class AuthService {
  static async login(credentials: LoginCredentials): Promise<AuthUser> {
    const user = await eventApi.login(credentials.email.trim(), credentials.password, credentials.recaptchaToken);
    activeUser = user;
    return user;
  }

  static async restoreSession(options: { force?: boolean } = {}): Promise<AuthUser | null> {
    if (activeUser && !options.force) return activeUser;
    try {
      activeUser = await eventApi.session();
      return activeUser;
    } catch (error) {
      if (error instanceof ApiError && [401, 403].includes(error.status)) {
        activeUser = null;
        return null;
      }
      return null;
    }
  }

  static async logout(): Promise<void> {
    try {
      await eventApi.logout();
    } finally {
      activeUser = null;
    }
  }

  static getCurrentUser(): AuthUser | null {
    return activeUser;
  }

  static isAuthenticated(): boolean {
    return Boolean(activeUser);
  }

  static getUserType(): UserType | null {
    return activeUser?.role || null;
  }

  static saveUser(user: AuthUser): void {
    activeUser = user;
  }

  // Google sign-in

  /** Reads the server-side availability flag, so a missing client id is visible. */
  static googleConfig(): Promise<GoogleConfig> {
    return eventApi.googleConfig();
  }

  /** Starts a server-bound flow and returns the client id and single-use nonce. */
  static googleSession(): Promise<GoogleSession> {
    return eventApi.googleSession();
  }

  /**
   * Verifies the Google credential on the server. A returning user is signed in
   * here; an unknown identity returns a prefill for the profile step instead.
   *
   * The optional selectedRole argument is retained for older callers as a
   * mismatch hint only; it never assigns or changes a role.
   */
  static async googleAuthenticate(credential: string, selectedRole?: string): Promise<GoogleAuthResult> {
    const result = await eventApi.googleAuthenticate(credential, selectedRole);
    if (result.status === 'signed_in') activeUser = result.user;
    return result;
  }

  static async completeGoogleProfile(): Promise<{ status: 'signed_in' | 'signup_pending'; user?: AuthUser; message?: string }> {
    const result = await eventApi.completeGoogleProfile();
    // AD003.3: a new signup stays pending with no session. Only a signed-in
    // (already-approved) account lands in the active session.
    if (result.status === 'signed_in' && result.user) activeUser = result.user;
    return result;
  }

  static async linkGoogle(credential: string): Promise<AuthUser> {
    const linked = await eventApi.linkGoogle(credential);
    activeUser = linked;
    return linked;
  }
}
