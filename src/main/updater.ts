import { app, dialog } from 'electron'
import electronUpdater from 'electron-updater'
import { getUiConfig } from './config'
import { t } from './i18n'
import { log } from './log'

const { autoUpdater } = electronUpdater

/** Автообновление из GitHub Releases; каналы stable (latest) и beta */
export function configureUpdater(): void {
  if (!app.isPackaged) return
  const beta = getUiConfig().updateChannel === 'beta'
  autoUpdater.channel = beta ? 'beta' : 'latest'
  autoUpdater.allowPrerelease = beta
  autoUpdater.allowDowngrade = false
  autoUpdater.autoDownload = true
  autoUpdater.logger = { info: log.info, warn: log.warn, error: log.error, debug: () => undefined }
}

export function startAutoUpdates(): void {
  if (!app.isPackaged || process.env.RESTLESS_DISABLE_UPDATES === '1') return
  configureUpdater()
  autoUpdater.checkForUpdatesAndNotify().catch((err: Error) => log.warn('update check failed:', err.message))
}

export async function checkForUpdatesManually(): Promise<void> {
  if (!app.isPackaged) {
    await dialog.showMessageBox({ type: 'info', message: t('updates.devMode') })
    return
  }
  try {
    configureUpdater()
    const res = await autoUpdater.checkForUpdates()
    const latest = res?.updateInfo.version
    const message =
      latest && latest !== app.getVersion() ? t('updates.available', { version: latest }) : t('updates.upToDate')
    await dialog.showMessageBox({ type: 'info', message })
  } catch (err) {
    await dialog.showMessageBox({ type: 'error', message: t('updates.failed'), detail: (err as Error).message })
  }
}
