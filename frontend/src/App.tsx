import React, { useEffect, useState } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { FlaskConical, Moon, Sun } from 'lucide-react';
import AppRoutes from './routes';
import { AuthProvider } from './context/AuthContext';
import { ThemeProvider, useTheme } from './context/ThemeContext';
import { Toaster } from 'react-hot-toast';
import { loadEnvironment, type EnvironmentInfo } from './data/eventApi';

/**
 * Sits above the router so it is impossible to miss, on the sign-in screen and
 * inside the app alike. The server decides the wording; the normal app sends an
 * empty label and nothing is rendered at all. An unreachable backend produces
 * its own label rather than silently looking like the normal app.
 */
const EnvironmentBanner: React.FC = () => {
  const [info, setInfo] = useState<EnvironmentInfo | null>(null);

  useEffect(() => {
    let active = true;
    loadEnvironment().then(value => { if (active) setInfo(value); });
    return () => { active = false; };
  }, []);

  if (!info?.deploymentLabel) return null;

  return (
    <div role="status" className="sticky top-0 z-50 flex items-center justify-center gap-2 bg-amber-500 px-4 py-2 text-center text-xs font-extrabold uppercase tracking-wide text-amber-950 shadow-lg">
      <FlaskConical size={16} className="shrink-0" aria-hidden="true" />
      {info.deploymentLabel}
    </div>
  );
};

/** GST001.5: persisted light/dark toggle, visible on every screen. */
const ThemeToggle: React.FC = () => {
  const { theme, toggle } = useTheme();
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      aria-pressed={theme === 'dark'}
      title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      className="fixed bottom-5 right-5 z-50 flex h-11 w-11 items-center justify-center rounded-full border border-[#E2E3DF] bg-white text-[#64748B] shadow-lg outline-none transition hover:text-[#C2410C] focus-visible:ring-2 focus-visible:ring-[#F97316] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
    >
      {theme === 'dark' ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}
    </button>
  );
};

const App: React.FC = () => (
  <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
    <ThemeProvider>
    <AuthProvider>
      <div className="min-h-screen bg-[#F5F4EC] font-sans text-[#334155] selection:bg-orange-200 selection:text-[#10203B] dark:bg-slate-950 dark:text-slate-200">
        <Toaster
          position="top-right"
          toastOptions={{
            duration: 3500,
            style: {
              background: 'rgba(255, 255, 255, 0.96)',
              color: '#334155',
              border: '1px solid #E2E3DF',
              borderRadius: '14px',
              boxShadow: '0 18px 40px -20px rgba(16, 32, 59, 0.32)',
              fontSize: '14px',
              backdropFilter: 'blur(16px)',
            },
            success: { iconTheme: { primary: '#16a34a', secondary: '#ffffff' } },
            error: { iconTheme: { primary: '#e11d48', secondary: '#ffffff' } },
          }}
        />
        <EnvironmentBanner />
        <AppRoutes />
        <ThemeToggle />
      </div>
    </AuthProvider>
    </ThemeProvider>
  </BrowserRouter>
);

export default App;
