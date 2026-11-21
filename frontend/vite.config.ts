import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const devProxyTarget = process.env.VITE_DEV_PROXY_TARGET ?? 'http://127.0.0.1:8080'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  envDir: '..',
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': {
        target: devProxyTarget,
        changeOrigin: true,
      },
      '/health': {
        target: devProxyTarget,
        changeOrigin: true,
      },
      '/ws': {
        target: devProxyTarget,
        ws: true,
        changeOrigin: true,
      },
    },
  },
  preview: {
    allowedHosts: ['app.zyvor.my.id'],
  },
})
