import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const target = process.env.API_URL || 'http://localhost:4000';

// Only real API prefixes are proxied (anchored regexes, so portal routes such as
// /browse/... are never sent to the API server by mistake).
//   /api/{name}/{version}[/{id}]   and the alias /apis/{name}/{version}[/{id}]
//   /admin/...
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '^/apis?(/|$)': { target, changeOrigin: true },
      '^/admin(/|$)': { target, changeOrigin: true },
      '^/health$': { target, changeOrigin: true },
    },
  },
});
