import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { closeTabWithConfirm, copyAsCurl, saveTab } from '../actions'
import { api } from '../api'
import { isDirty, useTabs } from '../store/tabs'
import { Icon } from './Icon'

export function TabsBar(): React.JSX.Element {
  const { t } = useTranslation()
  const tabs = useTabs((s) => s.tabs)
  const activeId = useTabs((s) => s.activeId)
  const activate = useTabs((s) => s.activate)
  const newTab = useTabs((s) => s.newTab)
  const move = useTabs((s) => s.move)
  const [dragId, setDragId] = useState<string | null>(null)

  const menu = async (id: string): Promise<void> => {
    const choice = await api.menu.popup({
      items: [
        { id: 'save', label: t('request.save') },
        { id: 'saveAs', label: t('request.saveAs') },
        { id: 'curl', label: t('curl.copy') },
        { id: 'sep', label: '', type: 'separator' },
        { id: 'close', label: t('tabs.close') },
        { id: 'closeOthers', label: t('tabs.closeOthers') }
      ]
    })
    if (choice === 'save') await saveTab(id)
    else if (choice === 'saveAs') await saveTab(id, true)
    else if (choice === 'curl') await copyAsCurl(id)
    else if (choice === 'close') await closeTabWithConfirm(id)
    else if (choice === 'closeOthers') useTabs.getState().closeOthers(id)
  }

  return (
    <div className="tabs-bar">
      <div className="tabs-scroll" role="tablist" aria-label={t('tabs.open')}>
        {tabs.map((tab, i) => {
          const dirty = isDirty(tab)
          const active = tab.id === activeId
          return (
            <div
              key={tab.id}
              role="tab"
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              className={`req-tab ${active ? 'active' : ''} ${dragId === tab.id ? 'dragging' : ''}`}
              onClick={() => activate(tab.id)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                  const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length]
                  activate(next.id)
                  ;(e.currentTarget.parentElement?.children[tabs.indexOf(next)] as HTMLElement | undefined)?.focus()
                }
                if (e.key === 'Delete') void closeTabWithConfirm(tab.id)
              }}
              onAuxClick={(e) => e.button === 1 && void closeTabWithConfirm(tab.id)}
              onContextMenu={(e) => {
                e.preventDefault()
                void menu(tab.id)
              }}
              draggable
              onDragStart={(e) => {
                setDragId(tab.id)
                e.dataTransfer.effectAllowed = 'move'
                e.dataTransfer.setData('text/x-restless-tab', tab.id)
              }}
              onDragEnd={() => setDragId(null)}
              onDragOver={(e) => {
                if (dragId) e.preventDefault()
              }}
              onDrop={(e) => {
                e.preventDefault()
                if (dragId) move(dragId, i)
                setDragId(null)
              }}
              title={`${tab.draft.method} ${tab.draft.url}`}
              data-testid="request-tab"
            >
              <span className={`method-badge method-${tab.draft.method.toLowerCase()}`}>{tab.draft.method}</span>
              <span className="req-tab-name">{tab.draft.name || t('request.untitled')}</span>
              {tab.sending && <span className="mini-spinner" aria-label={t('response.sending')} />}
              {dirty && (
                <span
                  className="dirty-dot"
                  title={t('tabs.unsaved')}
                  aria-label={t('tabs.unsaved')}
                  data-testid="dirty"
                />
              )}
              <button
                type="button"
                className="req-tab-close"
                tabIndex={-1}
                aria-label={t('tabs.closeNamed', { name: tab.draft.name })}
                onClick={(e) => {
                  e.stopPropagation()
                  void closeTabWithConfirm(tab.id)
                }}
              >
                <Icon name="close" size={12} />
              </button>
            </div>
          )
        })}
      </div>
      <button
        type="button"
        className="icon-btn new-tab"
        onClick={() => newTab()}
        title={`${t('menu.newRequest')} (Ctrl+N)`}
        aria-label={t('menu.newRequest')}
        data-testid="new-tab"
      >
        <Icon name="plus" />
      </button>
    </div>
  )
}
