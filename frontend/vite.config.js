import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const target = process.env.VITE_DEV_API || 'http://localhost:5000';
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
    },
    proxy: {
      '/api': { target, changeOrigin: true },
      '/socket.io': { target, ws: true, changeOrigin: true },
      '/sitemap.xml': { target, changeOrigin: true },
    },
  },
});
