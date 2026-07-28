import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// In dev we proxy AI calls through Vite to avoid browser CORS issues.
// The auth headers (x-goog-api-key / Authorization) are forwarded as-is.
export default defineConfig({
  plugins: [react()],
  // Pre-bundle deps that are only reached through lazy chunks, so Vite's dev
  // optimizer doesn't re-bundle them mid-session (which serves a 2nd React copy
  // → "Invalid hook call", or 504 "Outdated Optimize Dep" on the dynamic import).
  // - react/react-dom + @use-gesture/react: dedupe React (LevelCanvas).
  // - image-q: statically imported by aiTile.js, reached via the lazy AI panels.
  resolve: { dedupe: ['react', 'react-dom'] },
  optimizeDeps: { include: ['react', 'react-dom', '@use-gesture/react', 'image-q'] },
  build: {
    rollupOptions: {
      output: {
        // Isolate pixi.js (the bulk of the bundle) into its own chunk so it can
        // be loaded lazily with the Levels view instead of at app startup.
        manualChunks: {
          pixi: ['pixi.js', '@pixi/react'],
        },
      },
    },
  },
  server: {
    host: '0.0.0.0',
    port: 3000,
    allowedHosts: 'all',
    proxy: {
      '/gemini': {
        target: 'https://generativelanguage.googleapis.com',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/gemini/, ''),
      },
      '/openai': {
        target: 'https://api.openai.com',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/openai/, ''),
      },
      '/fal': {
        target: 'https://fal.run',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/fal/, ''),
      },
      '/cloudflare': {
        target: 'https://api.cloudflare.com',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/cloudflare/, ''),
      },
      '/recraft': {
        target: 'https://external.api.recraft.com',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/recraft/, ''),
      },
    },
  },
})
