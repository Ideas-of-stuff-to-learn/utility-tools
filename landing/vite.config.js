import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, '.', '')
  return {
    plugins: [react()],
    base: command === 'build' ? '/utility-tools/' : '/',
    server: { port: parseInt(env.LANDING_PORT) || 5174, strictPort: true },
  }
})
