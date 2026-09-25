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
    return <main className="app-workspace flex min-h-screen items-center justify-center bg-[#090b10] p-6 text-sm text-white/60">Validating secure session…</main>;
  }
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  if (allowedRoles && !allowedRoles.includes(user.role)) {
    return <Navigate to="/unauthorized" replace />;
  }
  return <>{children}</>;
}
