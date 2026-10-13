import { useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import type { MenuAction } from '@shared/ipc-channels'
import type { Language, ThemeSource } from '@shared/model'
import {
  closeTabWithConfirm,
  copyAsCurl,
  cycleEnvironment,
  formatActiveBody,
  importCurlPrompt,
  saveTab,
  sendTab
} from './actions'
import { api } from './api'
import { ConnectionScreen } from './components/ConnectionScreen'
import { Dialogs } from './components/Dialogs'
import { Header } from './components/Header'
import { Icon } from './components/Icon'
import { QuickSearch } from './components/QuickSearch'
import { Sidebar } from './components/sidebar/Sidebar'
import { VariablesModal } from './components/VariablesModal'
import { Workspace } from './components/Workspace'
import { useData } from './store/data'
import { startAutosave, useTabs } from './store/tabs'
import { useUi } from './store/ui'

function runAction(action: MenuAction): void {
  const ui = useUi.getState()
  const tabs = useTabs.getState()
  if (action.startsWith('theme:')) {
    void ui.setConfig({ theme: action.slice(6) as ThemeSource })
    return
  }
  if (action.startsWith('updateChannel:')) {
    void ui.setConfig({ updateChannel: action.slice(14) as 'stable' | 'beta' })
    return
  }
  if (action.startsWith('language:')) {
    void ui.setConfig({ language: action.slice(9) as Language })
    return
  }
  switch (action) {
    case 'newRequest':
      tabs.newTab()
      break
    case 'save':
      void saveTab()
      break
    case 'closeTab':
      if (tabs.activeId) void closeTabWithConfirm(tabs.activeId)
      break
    case 'nextTab':
      tabs.cycle(1)
      break
    case 'prevTab':
      tabs.cycle(-1)
      break
    case 'quickSearch':
      ui.setQuickSearch(true)
      break
    case 'formatBody':
      formatActiveBody()
      break
    case 'switchEnv':
      void cycleEnvironment()
      break
    case 'send':
      void sendTab()
      break
    case 'importCurl':
      void importCurlPrompt()
      break
    case 'copyCurl':
      void copyAsCurl()
      break
    case 'toggleSidebar':
      void ui.setConfig({ sidebarCollapsed: !ui.config.sidebarCollapsed })
      break
    case 'toggleLayout':
      void ui.setConfig({ responseLayout: ui.config.responseLayout === 'right' ? 'bottom' : 'right' })
      break
    case 'editVariables': {
      const env = useData.getState().environments.find((e) => e.isActive)
      ui.openVariables(env ? { scope: 'environment', scopeId: env.id } : { scope: 'global', scopeId: null })
      break
    }
  }
}

function shortcutFor(e: KeyboardEvent): MenuAction | null {
  const mod = navigator.platform.toLowerCase().includes('mac') ? e.metaKey : e.ctrlKey
  if (e.ctrlKey && e.key === 'Tab') return e.shiftKey ? 'prevTab' : 'nextTab'
  if (!mod || e.altKey) return null
  const key = e.key.toLowerCase()
  if (key === 'enter') return 'send'
  if (e.shiftKey && (key === 'f' || e.code === 'KeyF')) return 'formatBody'
  if (e.shiftKey) return null
  switch (e.code) {
    case 'KeyN':
      return 'newRequest'
    case 'KeyS':
      return 'save'
    case 'KeyW':
      return 'closeTab'
    case 'KeyP':
      return 'quickSearch'
    case 'KeyE':
      return 'switchEnv'
    case 'KeyB':
      return 'toggleSidebar'
    default:
      return null
  }
}

function Toasts(): React.JSX.Element {
  const { t } = useTranslation()
  const toasts = useUi((s) => s.toasts)
  const dismiss = useUi((s) => s.dismissToast)
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast-${toast.kind}`} data-testid={`toast-${toast.kind}`}>
          <span>{toast.text}</span>
          <button type="button" className="icon-btn" onClick={() => dismiss(toast.id)} aria-label={t('common.close')}>
            <Icon name="close" size={12} />
          </button>
        </div>
      ))}
    </div>
  )
}

export function App(): React.JSX.Element {
  const { t } = useTranslation()
  const db = useUi((s) => s.db)
  const setDb = useUi((s) => s.setDb)
  const applyConfig = useUi((s) => s.applyConfig)
  const loaded = useTabs((s) => s.loaded)

  const loadWorkspace = useCallback(async (): Promise<void> => {
    await Promise.all([useData.getState().loadAll(), useTabs.getState().load()])
  }, [])

  useEffect(() => {
    void api.db.status().then((status) => {
      setDb(status)
      if (status.connected) void loadWorkspace()
    })
  }, [setDb, loadWorkspace])

  useEffect(() => {
    const stopAutosave = startAutosave()
    const offMenu = api.on('menu:action', runAction)
    const offConfig = api.on('config:changed', applyConfig)
    const offQuit = api.on('app:beforeQuit', () => void useTabs.getState().persist())
    const onKey = (e: KeyboardEvent): void => {
      const action = shortcutFor(e)
      if (!action) return
      if (document.querySelector('dialog[open]') && action !== 'send') return
      e.preventDefault()
      e.stopPropagation()
      runAction(action)
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      stopAutosave()
      offMenu()
      offConfig()
      offQuit()
      window.removeEventListener('keydown', onKey, true)
    }
  }, [applyConfig])

  if (db === null) {
    return (
      <div className="app-loading" aria-busy="true">
        <div className="spinner" aria-label={t('common.loading')} />
      </div>
    )
  }

  if (!db.connected) {
    return (
      <>
        <ConnectionScreen onConnected={() => void loadWorkspace()} />
        <Toasts />
      </>
    )
  }

  return (
    <div className="app">
      <a href="#main-workspace" className="skip-link">
        {t('a11y.skipToEditor')}
      </a>
      <Header />
      <div className="app-body">
        <Sidebar />
        <div id="main-workspace" className="workspace-wrap">
          {loaded ? <Workspace /> : <div className="spinner" aria-label={t('common.loading')} />}
        </div>
      </div>
      <QuickSearch />
      <VariablesModal />
      <Dialogs />
      <Toasts />
    </div>
  )
}
