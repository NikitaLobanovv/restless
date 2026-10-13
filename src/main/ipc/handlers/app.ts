import { app, BrowserWindow, dialog, Menu, nativeTheme, safeStorage, type MenuItemConstructorOptions } from 'electron'
import { writeFile } from 'node:fs/promises'
import { updateUiConfig, getUiConfig } from '../../config'
import { connectWithUrl, getStatus, retry } from '../../db/client'
import { allowFiles } from '../../file-access'
import { setLanguage } from '../../i18n'
import { buildAppMenu } from '../../menu'
import { isWeakSecretStorage } from '../../secrets'
import { configureUpdater } from '../../updater'
import { broadcast } from '../../window'
import { handle } from '../register'

let startupConnect: Promise<unknown> = Promise.resolve()

export function setStartupConnect(p: Promise<unknown>): void {
  startupConnect = p
}

export function registerAppHandlers(): void {
  handle('app:info', () => ({
    version: app.getVersion(),
    platform: process.platform,
    isDev: !app.isPackaged,
    weakSecretStorage: isWeakSecretStorage(),
    secretStorageAvailable: safeStorage.isEncryptionAvailable()
  }))

  handle('config:get', () => getUiConfig())
  handle('config:set', (patch) => {
    const prev = getUiConfig()
    const next = updateUiConfig(patch)
    if (patch.theme && patch.theme !== prev.theme) nativeTheme.themeSource = next.theme
    if (patch.language && patch.language !== prev.language) setLanguage(next.language)
    if (patch.updateChannel && patch.updateChannel !== prev.updateChannel) configureUpdater()
    if (patch.theme || patch.language || patch.updateChannel) buildAppMenu()
    broadcast('config:changed', next)
    return next
  })

  handle('db:status', async () => {
    await startupConnect.catch(() => undefined)
    return getStatus()
  })
  handle('db:connect', ({ url }) => connectWithUrl(url))
  handle('db:retry', () => retry())

  handle('files:pick', async ({ multiple }, event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const opts: Electron.OpenDialogOptions = {
      properties: multiple ? ['openFile', 'multiSelections'] : ['openFile']
    }
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (res.canceled) return []
    allowFiles(res.filePaths)
    return res.filePaths
  })

  handle('files:saveText', async ({ defaultName, text }, event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const opts = { defaultPath: defaultName.replace(/[\\/:*?"<>|]/g, '_') }
    const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
    if (res.canceled || !res.filePath) return false
    await writeFile(res.filePath, text, 'utf8')
    return true
  })

  handle('menu:popup', ({ items }, event) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? undefined
    return new Promise<string | null>((resolve) => {
      let chosen: string | null = null
      const template: MenuItemConstructorOptions[] = items.map((item) =>
        item.type === 'separator'
          ? { type: 'separator' }
          : {
              label: item.label,
              enabled: item.enabled ?? true,
              click: () => {
                chosen = item.id
                resolve(item.id)
              }
            }
      )
      Menu.buildFromTemplate(template).popup({
        window: win,
        callback: () => setTimeout(() => resolve(chosen), 50)
      })
    })
  })
}
