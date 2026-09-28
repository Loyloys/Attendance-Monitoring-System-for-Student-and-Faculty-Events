import { ApiError, eventApi } from './eventApi';
import type { GoogleAuthResult, GoogleConfig, GoogleSession } from './eventApi';
import type { AuthUser, UserRole } from '../types/eventAttendance';

export type UserType = UserRole | 'lecturer';
export type { AuthUser };

export interface LoginCredentials {
  email: string;
  password: string;
  userType?: UserType;
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
    const user = await eventApi.login(credentials.email.trim(), credentials.password);
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
   * `selectedRole` is the account type chosen on the first screen. It is sent only
   * so the server can explain a mismatch and point at the right sign-in screen. It
   * never assigns a role: the server ignores it unless it matches the stored one.
   */
  static async googleAuthenticate(credential: string, selectedRole?: string): Promise<GoogleAuthResult> {
    const result = await eventApi.googleAuthenticate(credential, selectedRole);
    if (result.status === 'signed_in') activeUser = result.user;
    return result;
  }

  static async completeGoogleProfile(values: {
    accountId: string;
    department: string;
    name: string;
    phone: string;
  }): Promise<AuthUser> {
    const result = await eventApi.completeGoogleProfile(values);
    activeUser = result.user;
    return result.user;
  }

  static async linkGoogle(credential: string): Promise<AuthUser> {
    const linked = await eventApi.linkGoogle(credential);
    activeUser = linked;
    return linked;
  }
}

