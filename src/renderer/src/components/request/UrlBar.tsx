import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { HTTP_METHODS } from '@shared/model'
import { paramsFromUrl } from '@shared/url-params'
import { cancelTab, copyAsCurl, importCurlText, saveTab, sendTab } from '../../actions'
import { CodeEditor } from '../../editor/CodeEditor'
import { isDirty, useTabs, type Tab } from '../../store/tabs'
import { Icon } from '../Icon'

export function MethodSelect({ value, onChange }: { value: string; onChange: (m: string) => void }): React.JSX.Element {
  const { t } = useTranslation()
  const isCustom = !HTTP_METHODS.includes(value as (typeof HTTP_METHODS)[number])
  const [editing, setEditing] = useState(false)
  if (editing || isCustom) {
    return (
      <input
        className={`input method-input method-${value.toLowerCase()}`}
        value={value}
        autoFocus={editing}
        aria-label={t('request.customMethod')}
        onChange={(e) => {
          const v = e.target.value.toUpperCase().replace(/[^A-Z0-9!#$%&'*+.^_`|~-]/g, '')
          onChange(v || 'GET')
        }}
        onBlur={() => setEditing(false)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' || e.key === 'Enter') setEditing(false)
        }}
        maxLength={32}
        data-testid="method-input"
      />
    )
  }
  return (
    <select
      className={`method-select method-${value.toLowerCase()}`}
      value={value}
      aria-label={t('request.method')}
      data-testid="method-select"
      onChange={(e) => {
        if (e.target.value === '__custom__') setEditing(true)
        else onChange(e.target.value)
      }}
    >
      {HTTP_METHODS.map((m) => (
        <option key={m} value={m}>
          {m}
        </option>
      ))}
      <option value="__custom__">{t('request.customMethodOption')}</option>
    </select>
  )
}

export function UrlBar({ tab }: { tab: Tab }): React.JSX.Element {
  const { t } = useTranslation()
  const update = useTabs((s) => s.update)
  const dirty = isDirty(tab)

  return (
    <div className="url-bar">
      <MethodSelect value={tab.draft.method} onChange={(method) => update(tab.id, (d) => ({ ...d, method }))} />
      <div className="url-input">
        <CodeEditor
          singleLine
          variables
          value={tab.draft.url}
          ariaLabel={t('request.url')}
          testId="url-input"
          placeholder={t('request.urlPlaceholder')}
          onChange={(url) => {
            if (url === tab.draft.url) return
            update(tab.id, (d) => ({ ...d, url, params: paramsFromUrl(url, d.params) }))
          }}
          onEnter={() => void sendTab(tab.id)}
          onPaste={(text) => importCurlText(text)}
        />
      </div>
      {tab.sending ? (
        <button
          type="button"
          className="btn btn-danger btn-send"
          onClick={() => cancelTab(tab.id)}
          data-testid="cancel"
        >
          <Icon name="stop" /> {t('request.cancel')}
        </button>
      ) : (
        <button
          type="button"
          className="btn btn-primary btn-send"
          onClick={() => void sendTab(tab.id)}
          data-testid="send"
          title={`${t('request.send')} (Ctrl+Enter)`}
        >
          <Icon name="send" /> {t('request.send')}
        </button>
      )}
      <button
        type="button"
        className="icon-btn save-btn"
        onClick={() => void saveTab(tab.id)}
        title={`${t('request.save')} (Ctrl+S)`}
        aria-label={t('request.save')}
        data-testid="save"
      >
        <Icon name="save" />
        {dirty && <span className="dirty-dot save-dirty" aria-label={t('tabs.unsaved')} />}
      </button>
      <button
        type="button"
        className="icon-btn"
        onClick={() => void copyAsCurl(tab.id)}
        title={t('curl.copy')}
        aria-label={t('curl.copy')}
        data-testid="copy-curl"
      >
        <Icon name="copy" />
      </button>
    </div>
  )
}
