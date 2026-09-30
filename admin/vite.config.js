import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import staleBuildGuard from '../shared/vite-stale-build-guard.js'

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, '.', '')
  return {
    plugins: [react(), staleBuildGuard()],
    base: command === 'build' ? '/utility-tools/admin/' : '/',
    server: { port: parseInt(env.ADMIN_PORT) || 5175, strictPort: true },
  }
})
