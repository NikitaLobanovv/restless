import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { statusClass } from '@shared/http-utils'
import type { HistoryItem } from '@shared/model'
import { sendTab } from '../../actions'
import { api } from '../../api'
import { confirmDialog, saveAsDialog } from '../../store/dialogs'
import { useData } from '../../store/data'
import { useTabs } from '../../store/tabs'
import { useUi } from '../../store/ui'
import { Icon } from '../Icon'

function dayKey(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

function dayLabel(iso: string, lang: string, t: (k: string) => string): string {
  const d = new Date(iso)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (dayKey(iso) === dayKey(today.toISOString())) return t('history.today')
  if (dayKey(iso) === dayKey(yesterday.toISOString())) return t('history.yesterday')
  return d.toLocaleDateString(lang, { day: 'numeric', month: 'long', year: 'numeric' })
}

export function HistoryPanel({ query }: { query: string }): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const history = useData((s) => s.history)
  const loadHistory = useData((s) => s.loadHistory)
  const loadTree = useData((s) => s.loadTree)
  const fail = useUi((s) => s.fail)
  const toast = useUi((s) => s.toast)

  useEffect(() => {
    const timer = setTimeout(() => void loadHistory(query), 200)
    return () => clearTimeout(timer)
  }, [query, loadHistory])

  const groups = useMemo(() => {
    const out: { key: string; label: string; items: HistoryItem[] }[] = []
    for (const item of history) {
      const key = dayKey(item.createdAt)
      let g = out[out.length - 1]
      if (!g || g.key !== key) {
        g = { key, label: dayLabel(item.createdAt, i18n.language, t), items: [] }
        out.push(g)
      }
      g.items.push(item)
    }
    return out
  }, [history, i18n.language, t])

  const open = async (item: HistoryItem, replay: boolean): Promise<void> => {
    try {
      const detail = await api.history.get({ id: item.id })
      if (!detail) return
      const tabId = useTabs.getState().newTab(detail.draft)
      if (replay) await sendTab(tabId)
    } catch (err) {
      fail(err)
    }
  }

  const saveToCollection = async (item: HistoryItem): Promise<void> => {
    try {
      const detail = await api.history.get({ id: item.id })
      if (!detail) return
      if (useData.getState().tree.length === 0) {
        await api.collections.create({ name: t('collections.defaultName') })
        await loadTree()
      }
      const target = await saveAsDialog(detail.draft)
      if (!target) return
      const saved = await api.requests.save({ ...target, draft: { ...detail.draft, name: target.name } })
      await loadTree()
      useTabs.getState().openSaved(saved)
      toast('success', t('request.saved'))
    } catch (err) {
      fail(err)
    }
  }

  const menu = async (item: HistoryItem): Promise<void> => {
    const choice = await api.menu.popup({
      items: [
        { id: 'open', label: t('history.open') },
        { id: 'replay', label: t('history.replay') },
        { id: 'save', label: t('history.saveToCollection') },
        { id: 'sep', label: '', type: 'separator' },
        { id: 'delete', label: t('common.delete') }
      ]
    })
    if (choice === 'open') await open(item, false)
    else if (choice === 'replay') await open(item, true)
    else if (choice === 'save') await saveToCollection(item)
    else if (choice === 'delete') {
      try {
        await api.history.delete({ id: item.id })
        await loadHistory()
      } catch (err) {
        fail(err)
      }
    }
  }

  const clear = async (): Promise<void> => {
    const ok = await confirmDialog({
      title: t('history.clear'),
      message: t('history.clearConfirm'),
      confirmText: t('history.clear'),
      danger: true
    })
    if (!ok) return
    try {
      await api.history.clear()
      await loadHistory()
    } catch (err) {
      fail(err)
    }
  }

  if (history.length === 0) {
    return (
      <div className="empty-state small">
        <Icon name="history" size={32} />
        <p className="empty-title">{query ? t('common.nothingFound') : t('history.emptyTitle')}</p>
        {!query && <p className="muted">{t('history.emptyHint')}</p>}
      </div>
    )
  }

  return (
    <div className="history" data-testid="history">
      <div className="panel-actions">
        <span className="muted small">{t('history.count', { count: history.length })}</span>
        <button type="button" className="btn btn-small" onClick={() => void clear()}>
          <Icon name="trash" size={14} /> {t('history.clear')}
        </button>
      </div>
      {groups.map((g) => (
        <section key={g.key} aria-label={g.label}>
          <h3 className="group-title">{g.label}</h3>
          <ul className="history-list">
            {g.items.map((item) => (
              <li key={item.id} className="history-item" onContextMenu={(e) => (e.preventDefault(), void menu(item))}>
                <button
                  type="button"
                  className="history-open"
                  onClick={() => void open(item, false)}
                  title={item.url}
                  data-testid="history-item"
                >
                  <span className={`method-badge method-${item.method.toLowerCase()}`}>{item.method}</span>
                  <span className="history-url">{item.url}</span>
                  <span className={`status-mini status-${item.status ? statusClass(item.status) : 'error'}`}>
                    {item.status ?? 'ERR'}
                  </span>
                  <span className="history-time muted">
                    {new Date(item.createdAt).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => void open(item, true)}
                  title={t('history.replay')}
                  aria-label={t('history.replay')}
                  data-testid="history-replay"
                >
                  <Icon name="replay" size={14} />
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => void menu(item)}
                  aria-label={t('common.actions')}
                >
                  <Icon name="more" size={14} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
