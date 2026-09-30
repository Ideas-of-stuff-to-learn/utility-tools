import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import backend from '../backend-url.json' with { type: 'json' }
import staleBuildGuard from '../shared/vite-stale-build-guard.js'

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, '.', '')
  return {
    plugins: [
      react(),
      staleBuildGuard(),
      { name: 'backend-url', transformIndexHtml: html => html.replaceAll('__BACKEND_URL__', backend.url) },
    ],
    base: command === 'build' ? '/utility-tools/' : '/',
    server: { port: parseInt(env.LANDING_PORT) || 5174, strictPort: true },
  }
})
