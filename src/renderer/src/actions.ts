import { looksLikeCurl, parseCurl } from '@shared/curl/parse'
import { formatJson, formatXml } from '@shared/http-utils'
import type { RequestDraft } from '@shared/model'
import { referencedVariables } from '@shared/variables'
import { api } from './api'
import { i18n } from './i18n'
import { confirmDialog, promptDialog, saveAsDialog } from './store/dialogs'
import { useData } from './store/data'
import { isDirty, useTabs } from './store/tabs'
import { useUi } from './store/ui'

const t = (key: string, opts?: Record<string, unknown>): string => i18n.t(key, opts)

function activeTab() {
  const s = useTabs.getState()
  return s.tabs.find((x) => x.id === s.activeId) ?? null
}

export async function sendTab(tabId?: string): Promise<void> {
  const tabs = useTabs.getState()
  const tab = tabId ? tabs.tabs.find((x) => x.id === tabId) : activeTab()
  if (!tab || tab.sending) return
  if (tab.draft.url.trim() === '') {
    useUi.getState().toast('warning', t('request.urlRequired'))
    return
  }
  const hints = useData.getState().hints
  const missing = referencedVariables(tab.draft).filter((v) => !(v in hints))
  if (missing.length > 0) {
    useUi.getState().toast('warning', t('variables.unresolvedWarning', { names: missing.join(', ') }))
  }
  tabs.setSending(tab.id, true)
  try {
    const res = await api.http.send({ requestId: tab.id, draft: tab.draft, collectionId: tab.collectionId })
    useTabs.getState().setResponse(tab.id, res)
  } catch (err) {
    useUi.getState().fail(err)
  } finally {
    useTabs.getState().setSending(tab.id, false)
    if (useUi.getState().db?.connected) void useData.getState().loadHistory()
  }
}

export function cancelTab(tabId?: string): void {
  const tab = tabId ? useTabs.getState().tabs.find((x) => x.id === tabId) : activeTab()
  if (tab) void api.http.cancel({ requestId: tab.id })
}

export async function saveTab(tabId?: string, forceSaveAs = false): Promise<boolean> {
  const tab = tabId ? useTabs.getState().tabs.find((x) => x.id === tabId) : activeTab()
  if (!tab) return false
  try {
    if (tab.requestId && !forceSaveAs) {
      const current = await api.requests.get({ id: tab.requestId })
      if (current) {
        const saved = await api.requests.save({
          id: tab.requestId,
          collectionId: current.collectionId,
          folderId: current.folderId,
          draft: tab.draft
        })
        useTabs.getState().markSaved(tab.id, saved)
        void useData.getState().loadTree()
        return true
      }
    }
    if (useData.getState().tree.length === 0) {
      const name = await promptDialog({
        title: t('collections.createFirst'),
        label: t('common.name'),
        initial: t('collections.defaultName')
      })
      if (!name) return false
      await api.collections.create({ name })
      await useData.getState().loadTree()
    }
    const target = await saveAsDialog(tab.draft)
    if (!target) return false
    const saved = await api.requests.save({
      collectionId: target.collectionId,
      folderId: target.folderId,
      draft: { ...tab.draft, name: target.name }
    })
    useTabs.getState().markSaved(tab.id, saved)
    await useData.getState().loadTree()
    void useData.getState().loadHints(saved.collectionId)
    useUi.getState().toast('success', t('request.saved'))
    return true
  } catch (err) {
    useUi.getState().fail(err)
    return false
  }
}

export async function copyAsCurl(tabId?: string): Promise<void> {
  const tab = tabId ? useTabs.getState().tabs.find((x) => x.id === tabId) : activeTab()
  if (!tab) return
  try {
    const res = await api.curl.copy({ draft: tab.draft, collectionId: tab.collectionId })
    if (res.copied) useUi.getState().toast('success', t('curl.copied'))
  } catch (err) {
    useUi.getState().fail(err)
  }
}

export function importCurlText(text: string): boolean {
  if (!looksLikeCurl(text)) return false
  try {
    const draft = parseCurl(text)
    const tab = activeTab()
    if (tab && !tab.requestId && tab.draft.url.trim() === '') {
      useTabs.getState().update(tab.id, () => draft)
    } else {
      useTabs.getState().newTab(draft)
    }
    useUi.getState().toast('success', t('curl.imported'))
    return true
  } catch (err) {
    useUi.getState().toast('error', t('curl.parseError', { message: (err as Error).message }))
    return true
  }
}

export async function importCurlPrompt(): Promise<void> {
  const text = await promptDialog({
    title: t('curl.importTitle'),
    label: t('curl.importLabel'),
    confirmText: t('curl.import'),
    multiline: true
  })
  if (text && !importCurlText(text)) useUi.getState().toast('error', t('curl.notCurl'))
}

export function formatActiveBody(): void {
  const tab = activeTab()
  if (!tab) return
  const { type, raw } = tab.draft.body
  try {
    let formatted: string | null = null
    if (type === 'json') formatted = formatJson(raw)
    else if (type === 'xml') formatted = formatXml(raw)
    if (formatted !== null) {
      useTabs.getState().update(tab.id, (d: RequestDraft) => ({ ...d, body: { ...d.body, raw: formatted } }))
    }
  } catch (err) {
    useUi.getState().toast('error', t('body.formatError', { message: (err as Error).message }))
  }
}

export async function cycleEnvironment(): Promise<void> {
  const envs = useData.getState().environments
  if (envs.length === 0) {
    useUi.getState().setSidebarView('environments')
    return
  }
  const idx = envs.findIndex((e) => e.isActive)
  const next = idx + 1 < envs.length ? envs[idx + 1] : null
  await setActiveEnvironment(next?.id ?? null)
  useUi.getState().toast('info', t('env.switched', { name: next?.name ?? t('env.none') }))
}

export async function setActiveEnvironment(id: string | null): Promise<void> {
  try {
    await api.environments.setActive({ id })
    await Promise.all([useData.getState().loadEnvironments(), useData.getState().loadHints()])
  } catch (err) {
    useUi.getState().fail(err)
  }
}

export async function closeTabWithConfirm(id: string): Promise<void> {
  const tab = useTabs.getState().tabs.find((x) => x.id === id)
  if (!tab) return
  if (isDirty(tab) && tab.requestId) {
    const ok = await confirmDialog({
      title: t('tabs.unsavedTitle'),
      message: t('tabs.unsavedMessage', { name: tab.draft.name }),
      confirmText: t('tabs.closeWithoutSaving'),
      danger: true
    })
    if (!ok) return
  }
  useTabs.getState().close(id)
}
