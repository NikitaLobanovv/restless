import { create } from 'zustand'
import { emptyDraft, type HttpResult, type OpenTabState, type RequestDraft, type SavedRequest } from '@shared/model'
import { newId } from '@shared/url-params'
import { api } from '../api'
import { i18n } from '../i18n'
import { useData } from './data'
import { useUi } from './ui'

export interface Tab {
  id: string
  requestId: string | null
  collectionId: string | null
  draft: RequestDraft
  /** Последняя сохранённая версия (для новой вкладки — исходный черновик) */
  baseline: RequestDraft
  response: HttpResult | null
  sending: boolean
}

interface TabsState {
  tabs: Tab[]
  activeId: string | null
  loaded: boolean
  /** Были изменения с момента последней записи в БД */
  pendingPersist: boolean
  load(): Promise<void>
  newTab(draft?: RequestDraft, opts?: { collectionId?: string | null }): string
  openSaved(saved: SavedRequest): void
  close(id: string): void
  closeOthers(id: string): void
  activate(id: string): void
  cycle(dir: 1 | -1): void
  move(id: string, toIndex: number): void
  update(id: string, fn: (d: RequestDraft) => RequestDraft): void
  setResponse(id: string, response: HttpResult | null): void
  setSending(id: string, sending: boolean): void
  markSaved(id: string, saved: SavedRequest): void
  /** Синхронизация с деревом после переименования/удаления */
  onRequestRenamed(requestId: string, name: string): void
  onRequestsDeleted(requestIds: string[]): void
  persist(): Promise<void>
}

export function isDirty(tab: Tab): boolean {
  return JSON.stringify(tab.draft) !== JSON.stringify(tab.baseline)
}

function makeTab(draft: RequestDraft, partial: Partial<Tab> = {}): Tab {
  return {
    id: newId(),
    requestId: null,
    collectionId: null,
    draft,
    baseline: structuredClone(draft),
    response: null,
    sending: false,
    ...partial
  }
}

let persistTimer: ReturnType<typeof setTimeout> | null = null

export const useTabs = create<TabsState>((set, get) => {
  const changed = (patch: Partial<TabsState>, immediate = false): void => {
    set({ ...patch, pendingPersist: true })
    if (immediate) {
      // структура вкладок (открыть/закрыть/переключить) сохраняется быстро
      if (persistTimer) clearTimeout(persistTimer)
      persistTimer = setTimeout(() => void get().persist(), 300)
    }
  }

  return {
    tabs: [],
    activeId: null,
    loaded: false,
    pendingPersist: false,

    async load() {
      try {
        const stored = await api.tabs.load()
        const tabs: Tab[] = stored.map((s) => ({
          id: s.id,
          requestId: s.requestId,
          collectionId: s.collectionId,
          draft: s.draft,
          baseline: s.savedDraft ?? s.draft,
          response: null,
          sending: false
        }))
        const active = stored.find((s) => s.isActive)?.id ?? tabs[0]?.id ?? null
        set({ tabs, activeId: active, loaded: true, pendingPersist: false })
        if (tabs.length === 0) get().newTab()
      } catch (err) {
        useUi.getState().fail(err)
        set({ loaded: true })
      }
    },

    newTab(draft, opts) {
      const tab = makeTab(draft ?? { ...emptyDraft(), name: i18n.t('request.newName') }, {
        collectionId: opts?.collectionId ?? null
      })
      changed({ tabs: [...get().tabs, tab], activeId: tab.id }, true)
      return tab.id
    },

    openSaved(saved) {
      const existing = get().tabs.find((t) => t.requestId === saved.id)
      if (existing) {
        get().activate(existing.id)
        return
      }
      const tab = makeTab(saved.draft, { requestId: saved.id, collectionId: saved.collectionId })
      // пустую нетронутую вкладку заменяем, а не плодим новые
      const tabs = get().tabs
      const active = tabs.find((t) => t.id === get().activeId)
      const replace = active && !active.requestId && !isDirty(active) && !active.response && active.draft.url === ''
      changed(
        {
          tabs: replace ? tabs.map((t) => (t.id === active.id ? tab : t)) : [...tabs, tab],
          activeId: tab.id
        },
        true
      )
    },

    close(id) {
      const tabs = get().tabs
      const idx = tabs.findIndex((t) => t.id === id)
      if (idx < 0) return
      void api.http.cancel({ requestId: id }).catch(() => undefined)
      const next = tabs.filter((t) => t.id !== id)
      let activeId = get().activeId
      if (activeId === id) activeId = next[Math.min(idx, next.length - 1)]?.id ?? null
      changed({ tabs: next, activeId }, true)
      if (next.length === 0) get().newTab()
    },

    closeOthers(id) {
      changed({ tabs: get().tabs.filter((t) => t.id === id), activeId: id }, true)
    },

    activate(id) {
      if (get().activeId !== id) changed({ activeId: id }, true)
    },

    cycle(dir) {
      const { tabs, activeId } = get()
      if (tabs.length < 2) return
      const idx = tabs.findIndex((t) => t.id === activeId)
      const next = tabs[(idx + dir + tabs.length) % tabs.length]
      get().activate(next.id)
    },

    move(id, toIndex) {
      const tabs = [...get().tabs]
      const from = tabs.findIndex((t) => t.id === id)
      if (from < 0) return
      const [tab] = tabs.splice(from, 1)
      tabs.splice(Math.max(0, Math.min(toIndex, tabs.length)), 0, tab)
      changed({ tabs }, true)
    },

    update(id, fn) {
      changed({ tabs: get().tabs.map((t) => (t.id === id ? { ...t, draft: fn(t.draft) } : t)) })
    },

    setResponse(id, response) {
      set({ tabs: get().tabs.map((t) => (t.id === id ? { ...t, response } : t)) })
    },

    setSending(id, sending) {
      set({ tabs: get().tabs.map((t) => (t.id === id ? { ...t, sending } : t)) })
    },

    markSaved(id, saved) {
      changed(
        {
          tabs: get().tabs.map((t) =>
            t.id === id
              ? {
                  ...t,
                  requestId: saved.id,
                  collectionId: saved.collectionId,
                  draft: saved.draft,
                  baseline: structuredClone(saved.draft)
                }
              : t
          )
        },
        true
      )
    },

    onRequestRenamed(requestId, name) {
      changed({
        tabs: get().tabs.map((t) =>
          t.requestId === requestId ? { ...t, draft: { ...t.draft, name }, baseline: { ...t.baseline, name } } : t
        )
      })
    },

    onRequestsDeleted(ids) {
      const set_ = new Set(ids)
      // вкладка остаётся открытой как несохранённый черновик
      changed(
        {
          tabs: get().tabs.map((t) =>
            t.requestId && set_.has(t.requestId) ? { ...t, requestId: null, baseline: emptyDraft() } : t
          )
        },
        true
      )
    },

    async persist() {
      if (!get().loaded || !useUi.getState().db?.connected) return
      const { tabs, activeId } = get()
      const payload: OpenTabState[] = tabs.map((t, i) => ({
        id: t.id,
        requestId: t.requestId,
        collectionId: t.collectionId,
        draft: t.draft,
        savedDraft: t.baseline,
        position: i,
        isActive: t.id === activeId
      }))
      set({ pendingPersist: false })
      try {
        await api.tabs.save({ tabs: payload })
      } catch (err) {
        set({ pendingPersist: true })
        useUi.getState().fail(err)
      }
    }
  }
})

export function useActiveTab(): Tab | null {
  return useTabs((s) => s.tabs.find((t) => t.id === s.activeId) ?? null)
}

/** Автосохранение черновиков каждые 5 с (НФТ «Надёжность») */
export function startAutosave(): () => void {
  const timer = setInterval(() => {
    if (useTabs.getState().pendingPersist) void useTabs.getState().persist()
  }, 5000)
  return () => clearInterval(timer)
}

/** Перезагружает подсказки переменных, если сменилась коллекция активной вкладки */
useTabs.subscribe((s, prev) => {
  if (s.activeId === prev.activeId && s.tabs === prev.tabs) return
  const active = s.tabs.find((t) => t.id === s.activeId)
  const cid = active?.collectionId ?? null
  if (useUi.getState().db?.connected && cid !== useData.getState().hintsCollectionId) {
    void useData.getState().loadHints(cid)
  }
})
