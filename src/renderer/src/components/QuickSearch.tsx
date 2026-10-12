import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { RequestSearchResult } from '@shared/ipc'
import { api } from '../api'
import { useTabs } from '../store/tabs'
import { useUi } from '../store/ui'
import { Modal } from './Modal'

/** Ctrl+P: поиск сохранённых запросов по имени и URL */
export function QuickSearch(): React.JSX.Element | null {
  const { t } = useTranslation()
  const open = useUi((s) => s.quickSearchOpen)
  const setOpen = useUi((s) => s.setQuickSearch)
  const fail = useUi((s) => s.fail)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<RequestSearchResult[]>([])
  const [index, setIndex] = useState(0)

  useEffect(() => {
    if (!open) return
    const timer = setTimeout(() => {
      api.requests
        .search({ query })
        .then((r) => {
          setResults(r)
          setIndex(0)
        })
        .catch(fail)
    }, 120)
    return () => clearTimeout(timer)
  }, [open, query, fail])

  if (!open) return null

  const close = (): void => {
    setOpen(false)
    setQuery('')
  }
  const choose = async (r: RequestSearchResult | undefined): Promise<void> => {
    if (!r) return
    close()
    try {
      const saved = await api.requests.get({ id: r.id })
      if (saved) useTabs.getState().openSaved(saved)
    } catch (err) {
      fail(err)
    }
  }

  return (
    <Modal title={t('quickSearch.title')} onClose={close} className="quick-search" testId="quick-search">
      <input
        className="input"
        autoFocus
        value={query}
        placeholder={t('quickSearch.placeholder')}
        aria-label={t('quickSearch.placeholder')}
        aria-controls="quick-search-results"
        aria-activedescendant={results[index] ? `qs-${results[index].id}` : undefined}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setIndex((i) => Math.min(results.length - 1, i + 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setIndex((i) => Math.max(0, i - 1))
          } else if (e.key === 'Enter') {
            e.preventDefault()
            void choose(results[index])
          }
        }}
      />
      <ul id="quick-search-results" className="qs-results" role="listbox" aria-label={t('quickSearch.results')}>
        {results.length === 0 && <li className="empty-hint">{t('common.nothingFound')}</li>}
        {results.map((r, i) => (
          <li
            key={r.id}
            id={`qs-${r.id}`}
            role="option"
            aria-selected={i === index}
            className={`qs-item ${i === index ? 'active' : ''}`}
            onMouseEnter={() => setIndex(i)}
            onClick={() => void choose(r)}
          >
            <span className={`method-badge method-${r.method.toLowerCase()}`}>{r.method}</span>
            <span className="qs-name">{r.name}</span>
            <span className="qs-url muted">{r.url}</span>
            <span className="qs-collection muted">{r.collectionName}</span>
          </li>
        ))}
      </ul>
    </Modal>
  )
}
