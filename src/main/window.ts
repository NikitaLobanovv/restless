import { app, BrowserWindow, nativeTheme } from 'electron'
import { join } from 'node:path'
import type { AppEvent } from '../shared/ipc-channels'
import { rendererIndexFile } from './security'

let mainWindow: BrowserWindow | null = null
let allowClose = false
let pendingClose: (() => void) | null = null
let quitting = false

/** app.quit() отменяется, если окно отложило закрытие, — после сохранения вкладок повторяем выход */
app.on('before-quit', () => {
  quitting = true
})

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

export function broadcast(event: AppEvent, payload?: unknown): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(event, payload)
  }
}

/** Renderer сохранил вкладки — если окно ждёт закрытия, закрываем */
export function onTabsSaved(): void {
  pendingClose?.()
}

export function createMainWindow(): BrowserWindow {
  allowClose = false
  const win = new BrowserWindow({
    width: 1400,
    height: 880,
    minWidth: 800,
    minHeight: 500,
    show: false,
    title: 'Restless',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#16181d' : '#ffffff',
    autoHideMenuBar: false,
    icon: process.platform === 'linux' && !app.isPackaged ? join(__dirname, '../../build/icon.png') : undefined,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      spellcheck: false,
      devTools: !app.isPackaged || process.env.RESTLESS_DEVTOOLS === '1'
    }
  })
  mainWindow = win

  win.once('ready-to-show', () => win.show())

  // Перед закрытием даём renderer'у дописать черновики вкладок (не дольше 1,5 с)
  win.on('close', (event) => {
    if (allowClose) return
    event.preventDefault()
    const doClose = (): void => {
      if (allowClose) return
      allowClose = true
      pendingClose = null
      clearTimeout(timer)
      if (!win.isDestroyed()) win.close()
      if (quitting) app.quit()
    }
    const timer = setTimeout(doClose, 1500)
    pendingClose = doClose
    win.webContents.send('app:beforeQuit')
  })
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })

  const devUrl = !app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined
  if (devUrl) void win.loadURL(devUrl)
  else void win.loadFile(rendererIndexFile())
  return win
}
