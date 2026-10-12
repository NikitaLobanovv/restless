import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { autoContentType, hasHeader } from '@shared/http-utils'
import type { RequestSettings } from '@shared/model'
import { urlWithParams } from '@shared/url-params'
import { useTabs, type Tab } from '../../store/tabs'
import { KeyValueTable } from '../KeyValueTable'
import { Tabs } from '../Tabs'
import { BodyEditor } from './BodyEditor'
import { UrlBar } from './UrlBar'

type Section = 'params' | 'headers' | 'body' | 'auth' | 'settings'

function SettingsPanel({
  value,
  onChange
}: {
  value: RequestSettings
  onChange: (s: RequestSettings) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="settings-panel">
      <label className="field">
        <span>{t('settings.timeout')}</span>
        <input
          type="number"
          className="input"
          min={0}
          max={3600}
          step={1}
          value={value.timeoutMs / 1000}
          onChange={(e) => {
            const secs = Math.max(0, Math.min(3600, Number(e.target.value) || 0))
            onChange({ ...value, timeoutMs: Math.round(secs * 1000) })
          }}
          aria-describedby="timeout-hint"
        />
        <small id="timeout-hint" className="muted">
          {t('settings.timeoutHint')}
        </small>
      </label>
      <label className="toggle">
        <input
          type="checkbox"
          checked={value.followRedirects}
          onChange={(e) => onChange({ ...value, followRedirects: e.target.checked })}
        />
        <span>{t('settings.followRedirects')}</span>
      </label>
      <label className="toggle">
        <input
          type="checkbox"
          checked={value.verifySsl}
          onChange={(e) => onChange({ ...value, verifySsl: e.target.checked })}
        />
        <span>{t('settings.verifySsl')}</span>
      </label>
    </div>
  )
}

export function RequestEditor({ tab }: { tab: Tab }): React.JSX.Element {
  const { t } = useTranslation()
  const update = useTabs((s) => s.update)
  const [section, setSection] = useState<Section>('params')
  const { draft } = tab

  const auto = autoContentType(draft.body.type)
  const autoHeaders =
    auto && !hasHeader(draft.headers, 'content-type')
      ? [{ key: 'Content-Type', value: auto, note: t('headers.auto') }]
      : draft.body.type === 'multipart' && !hasHeader(draft.headers, 'content-type')
        ? [{ key: 'Content-Type', value: 'multipart/form-data; boundary=…', note: t('headers.auto') }]
        : []

  const count = (n: number): string => (n > 0 ? ` (${n})` : '')
  const enabledParams = draft.params.filter((p) => p.enabled && p.key).length
  const enabledHeaders = draft.headers.filter((h) => h.enabled && h.key).length

  return (
    <section className="request-editor" aria-label={t('request.editor')}>
      <UrlBar tab={tab} />
      <Tabs
        idPrefix="req"
        label={t('request.sections')}
        value={section}
        onChange={(v) => setSection(v as Section)}
        items={[
          { id: 'params', label: t('request.params') + count(enabledParams) },
          { id: 'headers', label: t('request.headers') + count(enabledHeaders) },
          { id: 'body', label: t('request.body') + (draft.body.type !== 'none' ? ' •' : '') },
          { id: 'auth', label: t('request.auth') },
          { id: 'settings', label: t('request.settings') }
        ]}
      />
      <div
        className="request-section"
        role="tabpanel"
        id={`req-panel-${section}`}
        aria-labelledby={`req-tab-${section}`}
      >
        {section === 'params' && (
          <KeyValueTable
            rows={draft.params}
            ariaLabel={t('request.params')}
            onChange={(params) =>
              // таблица → URL
              update(tab.id, (d) => ({ ...d, params, url: urlWithParams(d.url, params) }))
            }
          />
        )}
        {section === 'headers' && (
          <KeyValueTable
            rows={draft.headers}
            ariaLabel={t('request.headers')}
            autoRows={autoHeaders}
            onChange={(headers) => update(tab.id, (d) => ({ ...d, headers }))}
          />
        )}
        {section === 'body' && (
          <BodyEditor body={draft.body} onChange={(body) => update(tab.id, (d) => ({ ...d, body }))} />
        )}
        {section === 'auth' && (
          <div className="empty-state small">
            <p>{t('auth.comingSoon')}</p>
            <p className="muted">{t('auth.workaround', { example: 'Bearer {{token}}' })}</p>
          </div>
        )}
        {section === 'settings' && (
          <SettingsPanel value={draft.settings} onChange={(settings) => update(tab.id, (d) => ({ ...d, settings }))} />
        )}
      </div>
    </section>
  )
}
