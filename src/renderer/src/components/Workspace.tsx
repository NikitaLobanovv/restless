import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useActiveTab } from '../store/tabs'
import { useUi } from '../store/ui'
import { RequestEditor } from './request/RequestEditor'
import { ResponsePanel } from './response/ResponsePanel'
import { TabsBar } from './TabsBar'

/** Редактор запроса + панель ответа справа или снизу; разделитель перетаскивается, положение запоминается */
export function Workspace(): React.JSX.Element {
  const { t } = useTranslation()
  const tab = useActiveTab()
  const layout = useUi((s) => s.config.responseLayout)
  const ratio = useUi((s) => s.config.splitRatio)
  const setConfig = useUi((s) => s.setConfig)
  const [live, setLive] = useState<number | null>(null)
  const container = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  const horizontal = layout === 'right'
  const current = live ?? ratio

  const onMove = (e: React.PointerEvent): void => {
    if (!dragging.current || !container.current) return
    const rect = container.current.getBoundingClientRect()
    const r = horizontal ? (e.clientX - rect.left) / rect.width : (e.clientY - rect.top) / rect.height
    setLive(Math.max(0.15, Math.min(0.85, r)))
  }
  const onUp = (): void => {
    if (dragging.current && live !== null) void setConfig({ splitRatio: live })
    dragging.current = false
    setLive(null)
  }

  return (
    <main className="workspace">
      <TabsBar />
      {tab ? (
        <div ref={container} className={`split split-${horizontal ? 'h' : 'v'}`}>
          <div className="split-pane" style={{ flexBasis: `${current * 100}%` }}>
            <RequestEditor key={tab.id} tab={tab} />
          </div>
          <div
            className={`resizer ${horizontal ? 'resizer-v' : 'resizer-h'}`}
            role="separator"
            aria-orientation={horizontal ? 'vertical' : 'horizontal'}
            aria-label={t('layout.resize')}
            aria-valuenow={Math.round(current * 100)}
            aria-valuemin={15}
            aria-valuemax={85}
            tabIndex={0}
            onPointerDown={(e) => {
              dragging.current = true
              ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
            }}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onKeyDown={(e) => {
              const dec = horizontal ? 'ArrowLeft' : 'ArrowUp'
              const inc = horizontal ? 'ArrowRight' : 'ArrowDown'
              if (e.key === dec) void setConfig({ splitRatio: Math.max(0.15, ratio - 0.05) })
              if (e.key === inc) void setConfig({ splitRatio: Math.min(0.85, ratio + 0.05) })
            }}
          />
          <div className="split-pane split-pane-response" style={{ flexBasis: `${(1 - current) * 100}%` }}>
            <ResponsePanel key={tab.id} response={tab.response} sending={tab.sending} />
          </div>
        </div>
      ) : (
        <div className="empty-state">
          <p>{t('tabs.none')}</p>
        </div>
      )}
    </main>
  )
}
