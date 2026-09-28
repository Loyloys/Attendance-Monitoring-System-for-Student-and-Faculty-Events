import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  server: {
    // Keep the development origin aligned with backend/.env.example. Without
    // strictPort, a second Vite process silently moves to 5174 and Express
    // correctly rejects its login request as an untrusted CSRF origin.
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        // Must match PORT in backend/.env (8000). If the backend is started on a
        // different port, set VITE_API_PROXY_TARGET to the same value in
        // frontend/.env.local, otherwise every /api call returns an empty 502/500
        // and the browser reports "Unexpected end of JSON input".
        target: process.env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
  plugins: [react()],
})
