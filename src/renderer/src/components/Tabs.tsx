import { useRef } from 'react'

interface TabsProps {
  /** Префикс id: на экране несколько наборов вкладок */
  idPrefix: string
  label: string
  value: string
  onChange: (id: string) => void
  items: { id: string; label: string }[]
  className?: string
}

/** Доступные вкладки (WAI-ARIA tabs): стрелки, Home/End, видимый фокус */
export function Tabs({ idPrefix, label, value, onChange, items, className }: TabsProps): React.JSX.Element {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const onKeyDown = (e: React.KeyboardEvent, index: number): void => {
    let next = -1
    if (e.key === 'ArrowRight') next = (index + 1) % items.length
    else if (e.key === 'ArrowLeft') next = (index - 1 + items.length) % items.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = items.length - 1
    if (next >= 0) {
      e.preventDefault()
      onChange(items[next].id)
      refs.current[next]?.focus()
    }
  }
  return (
    <div className={`tabs ${className ?? ''}`} role="tablist" aria-label={label}>
      {items.map((item, i) => (
        <button
          key={item.id}
          ref={(el) => {
            refs.current[i] = el
          }}
          type="button"
          role="tab"
          id={`${idPrefix}-tab-${item.id}`}
          aria-selected={value === item.id}
          aria-controls={`${idPrefix}-panel-${item.id}`}
          tabIndex={value === item.id ? 0 : -1}
          className={`tab ${value === item.id ? 'active' : ''}`}
          onClick={() => onChange(item.id)}
          onKeyDown={(e) => onKeyDown(e, i)}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}
