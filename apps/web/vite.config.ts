import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  // The app shell (React, router, query, i18n) is ~170 kB gzipped; Tiptap is split out.
  build: { chunkSizeWarningLimit: 700 },
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:3000' },
  },
})
