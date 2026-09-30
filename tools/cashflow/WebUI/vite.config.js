import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import backend from '../../../backend-url.json' with { type: 'json' }

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, '../', '')
  return {
    plugins: [
      react(),
      { name: 'backend-url', transformIndexHtml: html => html.replaceAll('__BACKEND_URL__', backend.url) },
    ],
    base: command === 'build' ? '/utility-tools/cashflow/' : '/',
    envDir: '../',
    server: { port: parseInt(env.CASHFLOW_PORT) || 5173, strictPort: true },
  }
})