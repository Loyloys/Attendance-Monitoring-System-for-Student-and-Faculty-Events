import React from 'react';
import { BrowserRouter } from 'react-router-dom';
import AppRoutes from './routes';
import { AuthProvider } from './context/AuthContext';
import { Toaster } from 'react-hot-toast';

const App: React.FC = () => (
  <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
    <AuthProvider>
      <div className="min-h-screen bg-[#090b10] font-sans text-slate-100 selection:bg-blue-500/30 selection:text-white">
        <Toaster
          position="top-right"
          toastOptions={{
            duration: 3500,
            style: {
              background: 'rgba(20, 25, 34, 0.94)',
              color: '#f8fafc',
              border: '1px solid rgba(255, 255, 255, 0.09)',
              borderRadius: '14px',
              boxShadow: '0 20px 50px rgba(0, 0, 0, 0.32)',
              fontSize: '14px',
              backdropFilter: 'blur(16px)',
            },
            success: { iconTheme: { primary: '#22c55e', secondary: '#0f172a' } },
            error: { iconTheme: { primary: '#f43f5e', secondary: '#0f172a' } },
          }}
        />
        <AppRoutes />
      </div>
    </AuthProvider>
  </BrowserRouter>
);

export default App;
