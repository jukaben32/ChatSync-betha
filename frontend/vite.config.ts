import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// El build se escribe en ../public, que Vercel sirve como sitio estático.
export default defineConfig({
  plugins: [react()],
  build: { outDir: '../public', emptyOutDir: true },
  server: { proxy: { '/api': 'http://localhost:8080' } },
})
