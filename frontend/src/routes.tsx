import { Routes, Route, Navigate } from 'react-router-dom';

// Pages
import Login from './auth/Login';
import Register from './auth/Register';
import StudentDashboard from './pages/student/Dashboard';
import StudentAttendance from './pages/student/Attendance';
import LecturerDashboard from './pages/lecturer/Dashboard';
import LecturerClasses from './pages/lecturer/LecturerClasses';
import LecturerMarkAttendance from './pages/lecturer/MarkAttendance';
import AdminDashboard from './pages/admin/Dashboard';
import AdminUsers from './pages/admin/Users';
import SuperAdminDashboard from './pages/admin/SuperAdminDashboard';
import Portal from './pages/Portal';

// Components
import RequireAuth from './auth/RequireAuth';
import AdminPageWrapper from './components/layout/admin/PageWrapper';

export default function AppRoutes() {
  return (
    <Routes>
      {/* Public Routes */}
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/unauthorized" element={<div className="flex min-h-screen items-center justify-center p-6"><div className="max-w-md rounded-2xl bg-white p-8 text-center shadow-xl"><h1 className="text-2xl font-black text-slate-900">Access restricted</h1><p className="mt-2 text-slate-500">Your role does not have permission to view this page.</p><a className="mt-6 inline-block rounded-xl bg-[#092f28] px-5 py-3 font-bold text-white" href="/portal">Return to dashboard</a></div></div>} />
      <Route path="/portal" element={<RequireAuth><Portal /></RequireAuth>} />

      {/* Student Routes */}
      <Route
        path="/student/dashboard"
        element={
          <RequireAuth allowedRoles={['student']}>
            <StudentDashboard />
          </RequireAuth>
        }
      />
      <Route
        path="/student/attendance"
        element={
          <RequireAuth allowedRoles={['student']}>
            <StudentAttendance />
          </RequireAuth>
        }
      />

      {/* Faculty Routes */}
      <Route
        path="/faculty/dashboard"
        element={
          <RequireAuth allowedRoles={['faculty', 'lecturer']}>
            <LecturerDashboard />
          </RequireAuth>
        }
      />
      <Route
        path="/faculty/classes"
        element={
          <RequireAuth allowedRoles={['faculty', 'lecturer']}>
            <LecturerClasses />
          </RequireAuth>
        }
      />
      <Route
        path="/faculty/mark-attendance"
        element={
          <RequireAuth allowedRoles={['faculty', 'lecturer']}>
            <LecturerMarkAttendance />
          </RequireAuth>
        }
      />
      <Route
        path="/lecturer/dashboard"
        element={
          <RequireAuth allowedRoles={['faculty', 'lecturer']}>
            <LecturerDashboard />
          </RequireAuth>
        }
      />
      <Route
        path="/lecturer/classes"
        element={
          <RequireAuth allowedRoles={['faculty', 'lecturer']}>
            <LecturerClasses />
          </RequireAuth>
        }
      />
      <Route
        path="/lecturer/mark-attendance"
        element={
          <RequireAuth allowedRoles={['faculty', 'lecturer']}>
            <LecturerMarkAttendance />
          </RequireAuth>
        }
      />

      {/* Admin Routes */}
      <Route
        path="/admin/dashboard"
        element={
          <RequireAuth allowedRoles={['admin']}>
            <AdminPageWrapper>
              <AdminDashboard />
            </AdminPageWrapper>
          </RequireAuth>
        }
      />
      <Route
        path="/admin/users"
        element={
          <RequireAuth allowedRoles={['admin']}>
            <AdminPageWrapper>
              <AdminUsers />
            </AdminPageWrapper>
          </RequireAuth>
        }
      />
      <Route
        path="/admin/super"
        element={
          <RequireAuth allowedRoles={['admin']}>
            <AdminPageWrapper>
              <SuperAdminDashboard />
            </AdminPageWrapper>
          </RequireAuth>
        }
      />

      {/* Root route - redirect to login */}
      <Route path="/" element={<Navigate to="/login" replace />} />

      {/* Default redirect to login */}
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}
