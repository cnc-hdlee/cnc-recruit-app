import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const isViewer = env.VITE_VIEWER_MODE === 'true' || env.VITE_VIEWER_MODE === '1';
  return {
    plugins: [react()],
    base: './',
    resolve: {
      alias: { '@': path.resolve(__dirname, 'src') },
    },
    server: {
      port: 5173,
      strictPort: true,
    },
    build: {
      outDir: isViewer ? 'dist-viewer' : 'dist',
      emptyOutDir: true,
    },
  };
});
