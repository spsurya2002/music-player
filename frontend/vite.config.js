import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // Absolute, not './'. With a relative base the shell served at /songs/<id>
  // resolves ./assets/... to /songs/assets/..., which doesn't exist — the SPA
  // fallback then returns index.html and the browser refuses to run HTML as a
  // module script, leaving a blank page on refresh of any nested route.
  base: '/',
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
})
