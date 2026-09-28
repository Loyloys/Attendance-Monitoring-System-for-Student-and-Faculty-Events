import { Routes, Route, Navigate } from 'react-router-dom';
import AccountTypeSelection from './auth/AccountTypeSelection';
import Login from './auth/Login';
import CompleteGoogleProfile from './auth/CompleteGoogleProfile';
import RequireAuth from './auth/RequireAuth';
import Portal from './pages/Portal';
import AdminWorkspace from './pages/admin/Workspace';
import AdminPageWrapper from './components/layout/admin/PageWrapper';

export default function AppRoutes() {
  return (
    <Routes>
      {/* Two-step sign in. The first screen only routes to the second; it never
          grants a role. Each account type renders the same card with its own
          copy, and the stored profile role still decides what opens. */}
      <Route path="/login" element={<AccountTypeSelection />} />
      <Route path="/login/student" element={<Login />} />
      <Route path="/login/faculty" element={<Login />} />
      <Route path="/login/administrator" element={<Login />} />
      <Route path="/login/complete-profile" element={<CompleteGoogleProfile />} />
      <Route
        path="/unauthorized"
        element={
          <main className="app-workspace flex min-h-screen items-center justify-center bg-[#F5F4EC] p-6">
            <section className="app-card max-w-md p-8 text-center">
              <h1 className="text-2xl font-bold text-[#10203B]">Access restricted</h1>
              <p className="mt-2 text-sm text-[#64748B]">Your assigned role does not have permission to view this page.</p>
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
