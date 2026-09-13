import { type ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { AuthService } from "../data/authService";

interface RequireAuthProps {
  children: ReactNode;
  allowedRoles?: Array<'student' | 'faculty' | 'lecturer' | 'admin'>;
}

export default function RequireAuth({ children, allowedRoles }: RequireAuthProps) {
  const location = useLocation();
  const currentRole = AuthService.getUserType();

  if (!AuthService.isAuthenticated() || !currentRole) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (allowedRoles && !allowedRoles.includes(currentRole)) {
    return <Navigate to="/unauthorized" replace />;
  }

  return <>{children}</>;
}