import { ApiError, eventApi } from './eventApi';
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

  static async restoreSession(): Promise<AuthUser | null> {
    if (activeUser) return activeUser;
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
}

