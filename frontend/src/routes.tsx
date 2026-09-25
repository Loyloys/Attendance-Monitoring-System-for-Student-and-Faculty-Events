import { Routes, Route, Navigate } from 'react-router-dom';
import Login from './auth/Login';
import RequireAuth from './auth/RequireAuth';
import Portal from './pages/Portal';
import AdminWorkspace from './pages/admin/Workspace';
import AdminPageWrapper from './components/layout/admin/PageWrapper';

export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/unauthorized"
        element={
          <main className="app-workspace flex min-h-screen items-center justify-center bg-[#090b10] p-6">
            <section className="app-card max-w-md p-8 text-center">
              <h1 className="text-2xl font-bold text-white">Access restricted</h1>
              <p className="mt-2 text-sm text-white/50">Your assigned role does not have permission to view this page.</p>
              <a href="/portal" className="app-button-primary mt-6">Return to event workspace</a>
            </section>
          </main>
        }
      />
      <Route
        path="/portal"
        element={
          <RequireAuth allowedRoles={['student', 'faculty']}>
            <Portal />
          </RequireAuth>
        }
      />

      {/* Existing bookmarks now resolve to the same event-attendance workspace. */}
      <Route path="/student/dashboard" element={<Navigate to="/portal?view=dashboard" replace />} />
      <Route path="/student/attendance" element={<Navigate to="/portal?view=attendance" replace />} />
      <Route path="/lecturer/dashboard" element={<Navigate to="/portal?view=dashboard" replace />} />
      <Route path="/lecturer/mark-attendance" element={<Navigate to="/portal?view=attendance" replace />} />
      <Route path="/faculty/dashboard" element={<Navigate to="/portal?view=dashboard" replace />} />
      <Route path="/faculty/mark-attendance" element={<Navigate to="/portal?view=attendance" replace />} />

      <Route path="/admin/dashboard" element={<RequireAuth allowedRoles={['admin']}><AdminPageWrapper><AdminWorkspace /></AdminPageWrapper></RequireAuth>} />
      <Route path="/admin/users" element={<RequireAuth allowedRoles={['admin']}><AdminPageWrapper><AdminWorkspace /></AdminPageWrapper></RequireAuth>} />
      <Route path="/admin/events" element={<RequireAuth allowedRoles={['admin']}><AdminPageWrapper><AdminWorkspace /></AdminPageWrapper></RequireAuth>} />
      <Route path="/admin/attendance" element={<RequireAuth allowedRoles={['admin']}><AdminPageWrapper><AdminWorkspace /></AdminPageWrapper></RequireAuth>} />
      <Route path="/admin/reports" element={<RequireAuth allowedRoles={['admin']}><AdminPageWrapper><AdminWorkspace /></AdminPageWrapper></RequireAuth>} />
      <Route path="/admin/feedback" element={<RequireAuth allowedRoles={['admin']}><AdminPageWrapper><AdminWorkspace /></AdminPageWrapper></RequireAuth>} />
      <Route path="/admin/super" element={<Navigate to="/admin/dashboard" replace />} />

      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}
