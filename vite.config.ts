import { defineConfig } from 'vite';

export default defineConfig({
  envPrefix: ['VITE_', 'NEXT_PUBLIC_'],
  server: {
    port: 9010,
    proxy: {
      '/api': {
        changeOrigin: true,
        target: 'http://localhost:9004'
      }
    }
  }
});
