import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import type { UserRole } from '../types/eventAttendance';

interface RequireAuthProps {
  children: ReactNode;
  allowedRoles?: UserRole[];
}

export default function RequireAuth({ children, allowedRoles }: RequireAuthProps) {
  const location = useLocation();
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return <main className="app-workspace flex min-h-screen items-center justify-center bg-[#F5F4EC] p-6 text-sm text-[#64748B]">Validating secure session…</main>;
  }
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  // Registration activates a Student account immediately, so there is no pending
  // state to wait in here. An administrator who blocks an account (`rejected`)
  // or deactivates it produces a 403 from the server, which `Portal` and the
  // admin workspace surface as an error rather than silently loading a workspace.
  if (allowedRoles && !allowedRoles.includes(user.role)) {
    return <Navigate to="/unauthorized" replace />;
  }
  return <>{children}</>;
}
