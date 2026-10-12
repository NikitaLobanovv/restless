import { app, Menu, shell, type MenuItemConstructorOptions } from 'electron'
import type { MenuAction } from '../shared/ipc-channels'
import type { Language, ThemeSource } from '../shared/model'
import { getUiConfig } from './config'
import { t } from './i18n'
import { checkForUpdatesManually } from './updater'
import { broadcast, getMainWindow } from './window'

const REPO_URL = 'https://github.com/restless-app/restless'

function action(a: MenuAction): () => void {
  return () => getMainWindow()?.webContents.send('menu:action', a)
}

/**
 * Горячие клавиши обрабатывает renderer (чтобы они работали и внутри редакторов),
 * поэтому у пунктов меню `registerAccelerator: false` — сочетание только отображается.
 */
function item(label: string, a: MenuAction, accelerator?: string): MenuItemConstructorOptions {
  return { label, accelerator, registerAccelerator: false, click: action(a) }
}

function setConfig(patch: { theme?: ThemeSource; language?: Language }): void {
  // изменения применяет renderer через config:set — так состояние остаётся единым
  broadcast('menu:action', patch.theme ? `theme:${patch.theme}` : `language:${patch.language}`)
}

export function buildAppMenu(): void {
  const isMac = process.platform === 'darwin'
  const cfg = getUiConfig()
  const template: MenuItemConstructorOptions[] = []

  if (isMac) {
    template.push({
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    })
  }

  template.push({
    label: t('menu.file'),
    submenu: [
      item(t('menu.newRequest'), 'newRequest', 'CmdOrCtrl+N'),
      item(t('menu.save'), 'save', 'CmdOrCtrl+S'),
      { type: 'separator' },
      item(t('menu.importCurl'), 'importCurl'),
      item(t('menu.copyCurl'), 'copyCurl'),
      { type: 'separator' },
      item(t('menu.closeTab'), 'closeTab', 'CmdOrCtrl+W'),
      ...(isMac ? [] : [{ type: 'separator' } as const, { role: 'quit', label: t('menu.quit') } as const])
    ]
  })

  template.push({
    label: t('menu.edit'),
    submenu: [
      { role: 'undo', label: t('menu.undo') },
      { role: 'redo', label: t('menu.redo') },
      { type: 'separator' },
      { role: 'cut', label: t('menu.cut') },
      { role: 'copy', label: t('menu.copy') },
      { role: 'paste', label: t('menu.paste') },
      { role: 'selectAll', label: t('menu.selectAll') },
      { type: 'separator' },
      item(t('menu.formatBody'), 'formatBody', 'CmdOrCtrl+Shift+F')
    ]
  })

  template.push({
    label: t('menu.request'),
    submenu: [
      item(t('menu.send'), 'send', 'CmdOrCtrl+Enter'),
      item(t('menu.quickSearch'), 'quickSearch', 'CmdOrCtrl+P'),
      { type: 'separator' },
      item(t('menu.switchEnv'), 'switchEnv', 'CmdOrCtrl+E'),
      item(t('menu.editVariables'), 'editVariables'),
      { type: 'separator' },
      item(t('menu.nextTab'), 'nextTab', 'Ctrl+Tab'),
      item(t('menu.prevTab'), 'prevTab', 'Ctrl+Shift+Tab')
    ]
  })

  const themes: ThemeSource[] = ['system', 'light', 'dark']
  const languages: Language[] = ['ru', 'en']
  template.push({
    label: t('menu.view'),
    submenu: [
      item(t('menu.toggleSidebar'), 'toggleSidebar', 'CmdOrCtrl+B'),
      item(t('menu.toggleLayout'), 'toggleLayout'),
      { type: 'separator' },
      {
        label: t('menu.theme'),
        submenu: themes.map((th) => ({
          label: t(`theme.${th}`),
          type: 'radio' as const,
          checked: cfg.theme === th,
          click: () => setConfig({ theme: th })
        }))
      },
      {
        label: t('menu.language'),
        submenu: languages.map((l) => ({
          label: l === 'ru' ? 'Русский' : 'English',
          type: 'radio' as const,
          checked: cfg.language === l,
          click: () => setConfig({ language: l })
        }))
      },
      { type: 'separator' },
      { role: 'resetZoom', label: t('menu.resetZoom') },
      { role: 'zoomIn', label: t('menu.zoomIn') },
      { role: 'zoomOut', label: t('menu.zoomOut') },
      { type: 'separator' },
      { role: 'togglefullscreen', label: t('menu.fullscreen') },
      ...(!app.isPackaged
        ? [{ type: 'separator' } as const, { role: 'reload' } as const, { role: 'toggleDevTools' } as const]
        : [])
    ]
  })

  template.push({
    role: 'help',
    label: t('menu.help'),
    submenu: [
      { label: t('menu.docs'), click: () => void shell.openExternal(`${REPO_URL}#readme`) },
      { label: t('menu.reportIssue'), click: () => void shell.openExternal(`${REPO_URL}/issues`) },
      { type: 'separator' },
      { label: t('menu.checkUpdates'), click: () => void checkForUpdatesManually() },
      {
        label: t('menu.updateChannel'),
        submenu: (['stable', 'beta'] as const).map((ch) => ({
          label: ch,
          type: 'radio' as const,
          checked: cfg.updateChannel === ch,
          click: () => broadcast('menu:action', `updateChannel:${ch}`)
        }))
      },
      ...(isMac ? [] : [{ role: 'about', label: t('menu.about') } as const])
    ]
  })

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
