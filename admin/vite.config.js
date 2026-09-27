import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, '.', '')
  return {
    plugins: [react()],
    base: command === 'build' ? '/utility-tools/admin/' : '/',
    server: { port: parseInt(env.ADMIN_PORT) || 5175, strictPort: true },
  }
})
