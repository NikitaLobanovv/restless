import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'

const alias = { '@shared': resolve(__dirname, 'src/shared') }

/**
 * Строгий CSP в production-сборке renderer: без unsafe-eval и удалённых скриптов.
 * Дублирует заголовок из main (для file:// заголовки ответа применяются не всегда).
 * В dev-режиме не добавляется — HMR нужна inline-преамбула React Refresh.
 */
const PROD_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-src 'self' about:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'"
].join('; ')

function cspPlugin(): Plugin {
  return {
    name: 'restless-csp',
    apply: 'build',
    transformIndexHtml: (html) =>
      html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${PROD_CSP}" />`)
  }
}

export default defineConfig({
  main: {
    resolve: { alias },
    build: {
      externalizeDeps: true
    }
  },
  preload: {
    resolve: { alias },
    build: {
      // Sandbox-preload: один самодостаточный CJS-файл без внешних зависимостей
      externalizeDeps: false,
      rollupOptions: {
        output: { format: 'cjs', entryFileNames: '[name].js' }
      }
    }
  },
  renderer: {
    resolve: { alias },
    plugins: [react(), cspPlugin()],
    build: {
      // Без eval-подобных конструкций в бандле (строгий CSP)
      target: 'chrome140'
    }
  }
})
