import { app, session, shell, type WebContents } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { log } from './log'

const devServerUrl = (): string | undefined => (!app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined)

export function rendererIndexFile(): string {
  return join(__dirname, '../renderer/index.html')
}

/** URL, с которого разрешено обращаться к IPC и куда разрешено «навигировать» */
export function isTrustedUrl(url: string): boolean {
  const dev = devServerUrl()
  if (dev) {
    try {
      return new URL(url).origin === new URL(dev).origin
    } catch {
      return false
    }
  }
  const index = pathToFileURL(rendererIndexFile()).toString()
  return url === index || url.startsWith(`${index}#`) || url.startsWith(`${index}?`)
}

/** Строгий CSP: без unsafe-eval и удалённых скриптов. В dev нужен HMR-websocket и inline-преамбула React Refresh. */
function contentSecurityPolicy(): string {
  const dev = devServerUrl()
  const devWs = dev ? ` ws://${new URL(dev).host}` : ''
  return [
    "default-src 'self'",
    dev ? "script-src 'self' 'unsafe-inline'" : "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self'${devWs}`,
    "frame-src 'self' about:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'"
  ].join('; ')
}

export function setupSecurity(): void {
  const csp = contentSecurityPolicy()
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp],
        'X-Content-Type-Options': ['nosniff']
      }
    })
  })

  // никаких разрешений (камера, геолокация, уведомления, …) renderer'у не нужно
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  session.defaultSession.setPermissionCheckHandler(() => false)

  app.on('web-contents-created', (_event, contents) => hardenWebContents(contents))
}

function openExternalSafely(url: string): void {
  try {
    const u = new URL(url)
    if (u.protocol === 'http:' || u.protocol === 'https:') void shell.openExternal(u.toString())
  } catch {
    /* игнорируем некорректные ссылки */
  }
}

function hardenWebContents(contents: WebContents): void {
  contents.on('will-navigate', (event, url) => {
    if (isTrustedUrl(url)) return
    event.preventDefault()
    log.warn('Blocked navigation to', url)
    openExternalSafely(url)
  })
  contents.on('will-redirect', (event, url) => {
    if (!isTrustedUrl(url)) event.preventDefault()
  })
  contents.setWindowOpenHandler(({ url }) => {
    openExternalSafely(url)
    return { action: 'deny' }
  })
  contents.on('will-attach-webview', (event) => event.preventDefault())
}
