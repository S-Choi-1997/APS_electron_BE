import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    port: 5173,
    strictPort: true,
    host: 'localhost', // localhost에만 바인딩 (외부 접근 차단)
    cors: false, // CORS 비활성화
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
