import { create } from 'zustand'
import type { AppInfo } from '@shared/ipc'
import type { DbStatus, UiConfig, VariableScope } from '@shared/model'
import { api, errorMessage } from '../api'
import { changeLanguage, i18n } from '../i18n'

export type SidebarView = 'collections' | 'history' | 'environments'

export interface VariablesTarget {
  scope: VariableScope
  scopeId: string | null
}

export interface Toast {
  id: number
  kind: 'info' | 'success' | 'error' | 'warning'
  text: string
}

interface UiState {
  config: UiConfig
  info: AppInfo
  db: DbStatus | null
  sidebarView: SidebarView
  quickSearchOpen: boolean
  variables: VariablesTarget | null
  toasts: Toast[]
  init(config: UiConfig, info: AppInfo): void
  setConfig(patch: Partial<UiConfig>): Promise<void>
  applyConfig(config: UiConfig): void
  setDb(status: DbStatus | null): void
  setSidebarView(v: SidebarView): void
  setQuickSearch(open: boolean): void
  openVariables(target: VariablesTarget | null): void
  toast(kind: Toast['kind'], text: string): void
  dismissToast(id: number): void
  fail(err: unknown): void
}

let toastSeq = 0

function applyTheme(theme: UiConfig['theme']): void {
  if (theme === 'system') delete document.documentElement.dataset.theme
  else document.documentElement.dataset.theme = theme
}

export const useUi = create<UiState>((set, get) => ({
  config: null as unknown as UiConfig,
  info: null as unknown as AppInfo,
  db: null,
  sidebarView: 'collections',
  quickSearchOpen: false,
  variables: null,
  toasts: [],
  init(config, info) {
    applyTheme(config.theme)
    set({ config, info })
  },
  async setConfig(patch) {
    set({ config: { ...get().config, ...patch } })
    if (patch.theme) applyTheme(patch.theme)
    try {
      get().applyConfig(await api.config.set(patch))
    } catch (err) {
      get().fail(err)
    }
  },
  applyConfig(config) {
    applyTheme(config.theme)
    set({ config })
    if (i18n.language !== config.language) void changeLanguage(config.language)
  },
  setDb(db) {
    set({ db })
  },
  setSidebarView(sidebarView) {
    set({ sidebarView })
    if (get().config.sidebarCollapsed) void get().setConfig({ sidebarCollapsed: false })
  },
  setQuickSearch(quickSearchOpen) {
    set({ quickSearchOpen })
  },
  openVariables(variables) {
    set({ variables })
  },
  toast(kind, text) {
    const id = ++toastSeq
    set({ toasts: [...get().toasts.slice(-4), { id, kind, text }] })
    setTimeout(() => get().dismissToast(id), kind === 'error' ? 8000 : 4000)
  },
  dismissToast(id) {
    set({ toasts: get().toasts.filter((t) => t.id !== id) })
  },
  fail(err) {
    const msg = errorMessage(err)
    if (msg === 'DB_UNAVAILABLE') {
      set({ db: { connected: false, error: 'Database is unavailable' } })
      return
    }
    get().toast('error', msg)
  }
}))
