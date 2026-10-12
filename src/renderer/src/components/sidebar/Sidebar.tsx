import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../../api'
import { promptDialog } from '../../store/dialogs'
import { useData } from '../../store/data'
import { useUi, type SidebarView } from '../../store/ui'
import { Icon, type IconName } from '../Icon'
import { CollectionTree } from './CollectionTree'
import { EnvironmentsPanel } from './EnvironmentsPanel'
import { HistoryPanel } from './HistoryPanel'

const VIEWS: { id: SidebarView; icon: IconName }[] = [
  { id: 'collections', icon: 'collection' },
  { id: 'history', icon: 'history' },
  { id: 'environments', icon: 'env' }
]

export function Sidebar(): React.JSX.Element {
  const { t } = useTranslation()
  const view = useUi((s) => s.sidebarView)
  const setView = useUi((s) => s.setSidebarView)
  const width = useUi((s) => s.config.sidebarWidth)
  const collapsed = useUi((s) => s.config.sidebarCollapsed)
  const setConfig = useUi((s) => s.setConfig)
  const fail = useUi((s) => s.fail)
  const loadTree = useData((s) => s.loadTree)
  const [queries, setQueries] = useState<Record<SidebarView, string>>({
    collections: '',
    history: '',
    environments: ''
  })
  const [liveWidth, setLiveWidth] = useState<number | null>(null)
  const dragStart = useRef<{ x: number; w: number } | null>(null)

  const createCollection = async (): Promise<void> => {
    const name = await promptDialog({
      title: t('collections.create'),
      label: t('common.name'),
      initial: t('collections.defaultName')
    })
    if (!name) return
    try {
      await api.collections.create({ name })
      await loadTree()
    } catch (err) {
      fail(err)
    }
  }

  const onResizeStart = (e: React.PointerEvent): void => {
    dragStart.current = { x: e.clientX, w: width }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onResizeMove = (e: React.PointerEvent): void => {
    if (!dragStart.current) return
    setLiveWidth(Math.max(180, Math.min(600, dragStart.current.w + e.clientX - dragStart.current.x)))
  }
  const onResizeEnd = (): void => {
    if (dragStart.current && liveWidth !== null) void setConfig({ sidebarWidth: liveWidth })
    dragStart.current = null
    setLiveWidth(null)
  }

  return (
    <div className="sidebar-wrap">
      <nav className="activity-bar" aria-label={t('sidebar.title')}>
        {VIEWS.map((v) => (
          <button
            key={v.id}
            type="button"
            className={`activity-btn ${view === v.id && !collapsed ? 'active' : ''}`}
            aria-pressed={view === v.id && !collapsed}
            title={t(`sidebar.${v.id}`)}
            aria-label={t(`sidebar.${v.id}`)}
            data-testid={`sidebar-${v.id}`}
            onClick={() => {
              if (view === v.id && !collapsed) void setConfig({ sidebarCollapsed: true })
              else setView(v.id)
            }}
          >
            <Icon name={v.icon} size={20} />
          </button>
        ))}
        <span className="spacer" />
        <button
          type="button"
          className="activity-btn"
          title={t('sidebar.toggle')}
          aria-label={t('sidebar.toggle')}
          onClick={() => void setConfig({ sidebarCollapsed: !collapsed })}
        >
          <Icon name="sidebar" size={20} />
        </button>
      </nav>
      {!collapsed && (
        <aside className="sidebar" style={{ width: liveWidth ?? width }} aria-label={t(`sidebar.${view}`)}>
          <div className="sidebar-header">
            <h2>{t(`sidebar.${view}`)}</h2>
            {view === 'collections' && (
              <button
                type="button"
                className="icon-btn"
                onClick={() => void createCollection()}
                title={t('collections.create')}
                aria-label={t('collections.create')}
                data-testid="collection-create"
              >
                <Icon name="plus" />
              </button>
            )}
          </div>
          <div className="sidebar-search">
            <Icon name="search" size={14} />
            <input
              type="search"
              className="input input-plain"
              placeholder={t(`sidebar.search.${view}`)}
              aria-label={t(`sidebar.search.${view}`)}
              value={queries[view]}
              onChange={(e) => setQueries({ ...queries, [view]: e.target.value })}
            />
          </div>
          <div className="sidebar-content">
            {view === 'collections' && <CollectionTree query={queries.collections} />}
            {view === 'history' && <HistoryPanel query={queries.history} />}
            {view === 'environments' && <EnvironmentsPanel query={queries.environments} />}
          </div>
          <div
            className="resizer resizer-v"
            role="separator"
            aria-orientation="vertical"
            aria-label={t('sidebar.resize')}
            aria-valuenow={liveWidth ?? width}
            aria-valuemin={180}
            aria-valuemax={600}
            tabIndex={0}
            onPointerDown={onResizeStart}
            onPointerMove={onResizeMove}
            onPointerUp={onResizeEnd}
            onKeyDown={(e) => {
              if (e.key === 'ArrowLeft') void setConfig({ sidebarWidth: Math.max(180, width - 20) })
              if (e.key === 'ArrowRight') void setConfig({ sidebarWidth: Math.min(600, width + 20) })
            }}
          />
        </aside>
      )}
    </div>
  )
}
