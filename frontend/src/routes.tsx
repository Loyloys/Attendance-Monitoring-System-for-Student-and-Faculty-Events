import { Routes, Route, Navigate } from 'react-router-dom';
import Login from './auth/Login';
import CompleteGoogleProfile from './auth/CompleteGoogleProfile';
import RegistrationComplete from './auth/RegistrationComplete';
import SignupPending from './auth/SignupPending';
import RequireAuth from './auth/RequireAuth';
import Portal from './pages/Portal';
import AdminWorkspace from './pages/admin/Workspace';
import AdminPageWrapper from './components/layout/admin/PageWrapper';
import Signup from './auth/Signup';
import VerifyEmail from './auth/VerifyEmail';
import SetPassword from './auth/SetPassword';

export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      {/* Older role-specific sign-in bookmarks now use the shared sign-in form. */}
      <Route path="/login/:legacyAccountType" element={<Navigate to="/login" replace />} />
      <Route path="/login/complete-profile" element={<CompleteGoogleProfile />} />
      <Route path="/signup" element={<Signup />} />
      <Route path="/verify-email" element={<VerifyEmail />} />
      <Route path="/set-password" element={<SetPassword />} />
      {/* AD003.3: pending state after a signup request. No account exists yet. */}
      <Route path="/login/pending" element={<SignupPending />} />
      {/* Shown for a moment after a new Student account is created, confirming the
          registration succeeded and automatically activating the account. */}
      <Route
        path="/registration-complete"
        element={
          <RequireAuth>
            <RegistrationComplete />
          </RequireAuth>
        }
      />
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
      {/* AD003.3: review of email-only signup requests; approval creates the User. */}
      <Route path="/admin/signup-requests" element={<RequireAuth allowedRoles={['admin']}><AdminPageWrapper><AdminWorkspace /></AdminPageWrapper></RequireAuth>} />
      <Route path="/admin/users" element={<RequireAuth allowedRoles={['admin']}><AdminPageWrapper><AdminWorkspace /></AdminPageWrapper></RequireAuth>} />
      <Route path="/admin/events" element={<RequireAuth allowedRoles={['admin']}><AdminPageWrapper><AdminWorkspace /></AdminPageWrapper></RequireAuth>} />
      <Route path="/admin/attendance" element={<RequireAuth allowedRoles={['admin']}><AdminPageWrapper><AdminWorkspace /></AdminPageWrapper></RequireAuth>} />
      <Route path="/admin/reports" element={<RequireAuth allowedRoles={['admin']}><AdminPageWrapper><AdminWorkspace /></AdminPageWrapper></RequireAuth>} />
      <Route path="/admin/feedback" element={<RequireAuth allowedRoles={['admin']}><AdminPageWrapper><AdminWorkspace /></AdminPageWrapper></RequireAuth>} />
      <Route path="/admin/announcements" element={<RequireAuth allowedRoles={['admin']}><AdminPageWrapper><AdminWorkspace /></AdminPageWrapper></RequireAuth>} />
      <Route path="/admin/settings" element={<RequireAuth allowedRoles={['admin']}><AdminPageWrapper><AdminWorkspace /></AdminPageWrapper></RequireAuth>} />
      <Route path="/admin/super" element={<Navigate to="/admin/dashboard" replace />} />

      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}
