import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, '../', '')
  return {
    plugins: [react()],
    base: command === 'build' ? '/utility-tools/cashflow/' : '/',
    envDir: '../',
    server: { port: parseInt(env.CASHFLOW_PORT) || 5173, strictPort: true },
  }
})