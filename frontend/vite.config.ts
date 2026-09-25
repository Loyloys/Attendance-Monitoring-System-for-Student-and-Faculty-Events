import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  server: {
    // Keep the development origin aligned with backend/settings.py. Without
    // strictPort, a second Vite process silently moves to 5174 and Django
    // correctly rejects its login request as an untrusted CSRF origin.
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
  plugins: [react()],
})
