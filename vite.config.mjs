import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  root: path.resolve(__dirname, 'client'),
  publicDir: path.resolve(__dirname, 'public'),
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    allowedHosts: true,
    proxy: {
      '/api': 'http://localhost:8787',
      '/image-targets': 'http://localhost:8787',
      '/media': 'http://localhost:8787',
    },
  },
  build: {
    outDir: path.resolve(__dirname, 'client', 'dist'),
    emptyOutDir: true,
  },
})
