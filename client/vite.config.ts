import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // Dev only: forward /api to the Express server so the browser sees one origin (no CORS, cookies just work).
    proxy: {
      '/api': 'http://localhost:4000',
    },
  },
})
