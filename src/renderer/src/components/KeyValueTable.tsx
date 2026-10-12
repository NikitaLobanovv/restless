import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { FormField, KeyValue } from '@shared/model'
import { newId } from '@shared/url-params'
import { CodeEditor } from '../editor/CodeEditor'
import { api } from '../api'
import { useUi } from '../store/ui'
import { Icon } from './Icon'

type Row = KeyValue | FormField

interface Props<T extends Row> {
  rows: T[]
  onChange: (rows: T[]) => void
  ariaLabel: string
  /** multipart: поле может быть файлом */
  allowFiles?: boolean
  /** Строки «только для чтения» над таблицей (например, авто-заголовки) */
  autoRows?: { key: string; value: string; note: string }[]
  keyPlaceholder?: string
}

function blankRow<T extends Row>(id: string, allowFiles: boolean): T {
  const base: KeyValue = { id, key: '', value: '', description: '', enabled: true }
  return (allowFiles ? { ...base, kind: 'text', files: [] } : base) as T
}

/**
 * Таблица ключ / значение / описание / «включено».
 * Последняя строка всегда пустая — ввод в неё создаёт новую запись.
 */
export function KeyValueTable<T extends Row>(props: Props<T>): React.JSX.Element {
  const { t } = useTranslation()
  const { rows, onChange, allowFiles = false } = props
  // стабильный id пустой строки, чтобы её редакторы не пересоздавались на каждый рендер
  const blankId = useRef(newId())
  if (rows.some((r) => r.id === blankId.current)) blankId.current = newId()
  const display = [...rows, blankRow<T>(blankId.current, allowFiles)]
  const fail = useUi((s) => s.fail)

  const patch = (index: number, change: Partial<FormField>): void => {
    if (index >= rows.length) {
      onChange([...rows, { ...display[index], ...change } as T])
    } else {
      onChange(rows.map((r, i) => (i === index ? ({ ...r, ...change } as T) : r)))
    }
  }
  const remove = (index: number): void => onChange(rows.filter((_, i) => i !== index))

  const pickFiles = async (index: number): Promise<void> => {
    try {
      const files = await api.files.pick({ multiple: true })
      if (files.length) patch(index, { kind: 'file', files })
    } catch (err) {
      fail(err)
    }
  }

  return (
    <div className="kv-table" role="table" aria-label={props.ariaLabel}>
      <div className="kv-row kv-head" role="row">
        <span role="columnheader" className="kv-check">
          <span className="sr-only">{t('kv.enabled')}</span>
        </span>
        <span role="columnheader">{t('kv.key')}</span>
        <span role="columnheader">{t('kv.value')}</span>
        <span role="columnheader">{t('kv.description')}</span>
        <span role="columnheader" className="kv-actions" />
      </div>
      {props.autoRows?.map((r) => (
        <div className="kv-row kv-auto" role="row" key={`auto-${r.key}`}>
          <span role="cell" className="kv-check">
            <input type="checkbox" checked disabled aria-label={t('kv.enabled')} />
          </span>
          <span role="cell" className="kv-static">
            {r.key}
          </span>
          <span role="cell" className="kv-static">
            {r.value}
          </span>
          <span role="cell" className="kv-static muted">
            {r.note}
          </span>
          <span role="cell" className="kv-actions" />
        </div>
      ))}
      {display.map((row, i) => {
        const isNew = i === rows.length
        const field = row as FormField
        const isFile = allowFiles && field.kind === 'file'
        return (
          <div className={`kv-row ${row.enabled ? '' : 'kv-disabled'}`} role="row" key={row.id}>
            <span role="cell" className="kv-check">
              {!isNew && (
                <input
                  type="checkbox"
                  checked={row.enabled}
                  onChange={(e) => patch(i, { enabled: e.target.checked })}
                  aria-label={t('kv.enabledFor', { key: row.key || t('kv.row', { n: i + 1 }) })}
                />
              )}
            </span>
            <span role="cell" className="kv-cell">
              <CodeEditor
                singleLine
                variables
                value={row.key}
                onChange={(v) => v !== row.key && patch(i, { key: v })}
                placeholder={props.keyPlaceholder ?? t('kv.key')}
                ariaLabel={t('kv.keyRow', { n: i + 1 })}
              />
            </span>
            <span role="cell" className="kv-cell kv-value">
              {isFile ? (
                <span className="kv-files">
                  <Icon name="file" />
                  <span className="kv-files-names" title={field.files.join('\n')}>
                    {field.files.length ? field.files.map((f) => f.split(/[\\/]/).pop()).join(', ') : t('kv.noFile')}
                  </span>
                  <button type="button" className="btn btn-small" onClick={() => void pickFiles(i)}>
                    {t('kv.chooseFiles')}
                  </button>
                </span>
              ) : (
                <CodeEditor
                  singleLine
                  variables
                  value={row.value}
                  onChange={(v) => v !== row.value && patch(i, { value: v })}
                  placeholder={t('kv.value')}
                  ariaLabel={t('kv.valueRow', { n: i + 1 })}
                />
              )}
              {allowFiles && !isNew && (
                <select
                  className="kv-kind"
                  value={field.kind}
                  aria-label={t('kv.kind')}
                  onChange={(e) => patch(i, { kind: e.target.value as 'text' | 'file', files: [] })}
                >
                  <option value="text">{t('kv.text')}</option>
                  <option value="file">{t('kv.file')}</option>
                </select>
              )}
            </span>
            <span role="cell" className="kv-cell">
              <input
                className="input input-plain"
                value={row.description}
                placeholder={t('kv.description')}
                aria-label={t('kv.descriptionRow', { n: i + 1 })}
                onChange={(e) => patch(i, { description: e.target.value })}
              />
            </span>
            <span role="cell" className="kv-actions">
              {!isNew && (
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => remove(i)}
                  aria-label={t('kv.removeRow', { n: i + 1 })}
                  title={t('common.delete')}
                >
                  <Icon name="trash" size={14} />
                </button>
              )}
            </span>
          </div>
        )
      })}
    </div>
  )
}
