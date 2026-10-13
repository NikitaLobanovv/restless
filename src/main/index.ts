import { app, BrowserWindow, nativeTheme, safeStorage } from 'electron'
import { getUiConfig } from './config'
import { closeDb, connectOnStartup } from './db/client'
import { setLanguage } from './i18n'
import { registerAppHandlers, setStartupConnect } from './ipc/handlers/app'
import { registerDataHandlers } from './ipc/handlers/data'
import { registerHttpHandlers } from './ipc/handlers/http'
import { assertAllChannelsRegistered } from './ipc/register'
import { log } from './log'
import { buildAppMenu } from './menu'
import { setupSecurity } from './security'
import { startAutoUpdates } from './updater'
import { createMainWindow, getMainWindow } from './window'

app.enableSandbox()

if (process.env.RESTLESS_USER_DATA) app.setPath('userData', process.env.RESTLESS_USER_DATA)

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = getMainWindow()
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  process.on('unhandledRejection', (reason) => log.error('Unhandled rejection:', reason))

  void app.whenReady().then(() => {
    if (process.platform === 'linux' && !safeStorage.isEncryptionAvailable()) {
      safeStorage.setUsePlainTextEncryption(true)
    }
    const cfg = getUiConfig()
    nativeTheme.themeSource = cfg.theme
    setLanguage(cfg.language)
    setupSecurity()

    registerAppHandlers()
    registerHttpHandlers()
    registerDataHandlers()
    assertAllChannelsRegistered()

    setStartupConnect(connectOnStartup())

    buildAppMenu()
    createMainWindow()
    startAutoUpdates()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('will-quit', () => {
    void closeDb()
  })
}
