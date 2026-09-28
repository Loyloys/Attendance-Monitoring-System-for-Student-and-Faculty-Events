import React from 'react';
import { BrowserRouter } from 'react-router-dom';
import AppRoutes from './routes';
import { AuthProvider } from './context/AuthContext';
import { Toaster } from 'react-hot-toast';

const App: React.FC = () => (
  <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
    <AuthProvider>
      <div className="min-h-screen bg-[#F5F4EC] font-sans text-[#334155] selection:bg-orange-200 selection:text-[#10203B]">
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
        <AppRoutes />
      </div>
    </AuthProvider>
  </BrowserRouter>
);

export default App;
