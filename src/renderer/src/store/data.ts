import { create } from 'zustand'
import type {
  CollectionNode,
  EnvironmentInfo,
  FolderNode,
  HistoryItem,
  RequestSummary,
  VariableHint
} from '@shared/model'
import { api } from '../api'
import { useUi } from './ui'

interface DataState {
  tree: CollectionNode[]
  environments: EnvironmentInfo[]
  history: HistoryItem[]
  historyQuery: string
  /** Подсказки переменных для текущей коллекции активной вкладки */
  hints: Record<string, VariableHint>
  hintsCollectionId: string | null
  loadTree(): Promise<void>
  loadEnvironments(): Promise<void>
  loadHistory(query?: string): Promise<void>
  loadHints(collectionId?: string | null): Promise<void>
  loadAll(): Promise<void>
}

export const useData = create<DataState>((set, get) => ({
  tree: [],
  environments: [],
  history: [],
  historyQuery: '',
  hints: {},
  hintsCollectionId: null,
  async loadTree() {
    try {
      set({ tree: await api.collections.tree() })
    } catch (err) {
      useUi.getState().fail(err)
    }
  },
  async loadEnvironments() {
    try {
      set({ environments: await api.environments.list() })
    } catch (err) {
      useUi.getState().fail(err)
    }
  },
  async loadHistory(query) {
    const q = query ?? get().historyQuery
    set({ historyQuery: q })
    try {
      set({ history: await api.history.list({ query: q || undefined }) })
    } catch (err) {
      useUi.getState().fail(err)
    }
  },
  async loadHints(collectionId) {
    const cid = collectionId === undefined ? get().hintsCollectionId : collectionId
    try {
      set({ hints: await api.variables.hints({ collectionId: cid }), hintsCollectionId: cid })
    } catch (err) {
      useUi.getState().fail(err)
    }
  },
  async loadAll() {
    await Promise.all([get().loadTree(), get().loadEnvironments(), get().loadHistory(), get().loadHints()])
  }
}))

/* ---------- Утилиты по дереву ---------- */

export function findRequest(tree: CollectionNode[], id: string): RequestSummary | null {
  const walk = (folders: FolderNode[], requests: RequestSummary[]): RequestSummary | null => {
    const r = requests.find((x) => x.id === id)
    if (r) return r
    for (const f of folders) {
      const found = walk(f.folders, f.requests)
      if (found) return found
    }
    return null
  }
  for (const c of tree) {
    const found = walk(c.folders, c.requests)
    if (found) return found
  }
  return null
}

export function findFolder(tree: CollectionNode[], id: string): FolderNode | null {
  const walk = (folders: FolderNode[]): FolderNode | null => {
    for (const f of folders) {
      if (f.id === id) return f
      const found = walk(f.folders)
      if (found) return found
    }
    return null
  }
  for (const c of tree) {
    const found = walk(c.folders)
    if (found) return found
  }
  return null
}

/** Плоский список «коллекция / папка / подпапка» для выбора места сохранения */
export function flattenContainers(
  tree: CollectionNode[]
): { collectionId: string; folderId: string | null; label: string; depth: number }[] {
  const out: { collectionId: string; folderId: string | null; label: string; depth: number }[] = []
  const walk = (collectionId: string, folders: FolderNode[], prefix: string, depth: number): void => {
    for (const f of folders) {
      const label = `${prefix} / ${f.name}`
      out.push({ collectionId, folderId: f.id, label, depth })
      walk(collectionId, f.folders, label, depth + 1)
    }
  }
  for (const c of tree) {
    out.push({ collectionId: c.id, folderId: null, label: c.name, depth: 0 })
    walk(c.id, c.folders, c.name, 1)
  }
  return out
}
