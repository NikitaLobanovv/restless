import { openSearchPanel } from '@codemirror/search'
import type { EditorView } from '@codemirror/view'
import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { bodyLanguage, formatBytes, formatDuration, statusClass } from '@shared/http-utils'
import type { HttpResponseData, HttpResult, TimelinePhases } from '@shared/model'
import { api } from '../../api'
import { CodeEditor } from '../../editor/CodeEditor'
import { useUi } from '../../store/ui'
import { Icon } from '../Icon'
import { Tabs } from '../Tabs'

type View = 'body' | 'headers' | 'cookies' | 'timeline'
type BodyMode = 'pretty' | 'raw' | 'preview'

const PRETTY_LIMIT = 5 * 1024 * 1024

function prettyBody(res: HttpResponseData): { text: string; lang: 'json' | 'xml' | 'html' | 'text' } {
  const lang = bodyLanguage(res.contentType, res.bodyText)
  if (lang === 'json' && res.bodyText.length <= PRETTY_LIMIT) {
    try {
      return { text: JSON.stringify(JSON.parse(res.bodyText), null, 2), lang }
    } catch {
      return { text: res.bodyText, lang: 'text' }
    }
  }
  return { text: res.bodyText, lang }
}

function Timeline({ phases, total }: { phases: TimelinePhases; total: number }): React.JSX.Element {
  const { t } = useTranslation()
  const rows: [string, number | undefined][] = [
    [t('timeline.dns'), phases.dnsMs],
    [t('timeline.tcp'), phases.tcpMs],
    [t('timeline.tls'), phases.tlsMs],
    [t('timeline.ttfb'), phases.ttfbMs],
    [t('timeline.download'), phases.downloadMs]
  ]
  const max = Math.max(total, 1)
  let offset = 0
  return (
    <div className="timeline" role="table" aria-label={t('response.timeline')}>
      {rows.map(([label, ms]) => {
        const start = offset
        if (ms !== undefined) offset += ms
        return (
          <div className="timeline-row" role="row" key={label}>
            <span role="cell" className="timeline-label">
              {label}
            </span>
            <span role="cell" className="timeline-track">
              {ms !== undefined && (
                <span
                  className="timeline-bar"
                  style={{ left: `${(start / max) * 100}%`, width: `${Math.max((ms / max) * 100, 0.5)}%` }}
                />
              )}
            </span>
            <span role="cell" className="timeline-value">
              {ms === undefined ? '—' : formatDuration(ms)}
            </span>
          </div>
        )
      })}
      <div className="timeline-row timeline-total" role="row">
        <span role="cell" className="timeline-label">
          {t('timeline.total')}
        </span>
        <span role="cell" className="timeline-track" />
        <span role="cell" className="timeline-value">
          {formatDuration(total)}
        </span>
      </div>
      <p className="muted small">{t('timeline.note')}</p>
    </div>
  )
}

function ResponseBody({ res }: { res: HttpResponseData }): React.JSX.Element {
  const { t } = useTranslation()
  const fail = useUi((s) => s.fail)
  const toast = useUi((s) => s.toast)
  const lang = bodyLanguage(res.contentType, res.bodyText)
  const canPreview = !!res.imageDataUrl || lang === 'html'
  const [mode, setMode] = useState<BodyMode>(res.imageDataUrl ? 'preview' : 'pretty')
  const viewRef = useRef<EditorView | null>(null)
  const pretty = useMemo(() => (res.isLarge ? null : prettyBody(res)), [res])
  const effective: BodyMode = res.isLarge && mode === 'pretty' ? 'raw' : mode

  const save = async (): Promise<void> => {
    try {
      if (await api.http.saveBody({ responseId: res.responseId })) toast('success', t('response.savedToFile'))
    } catch (err) {
      fail(err)
    }
  }
  const copy = async (): Promise<void> => {
    try {
      if (await api.http.copyBody({ responseId: res.responseId })) toast('success', t('response.copied'))
      else toast('warning', t('response.expired'))
    } catch (err) {
      fail(err)
    }
  }

  return (
    <div className="response-body">
      <div className="response-toolbar">
        <div className="segmented" role="radiogroup" aria-label={t('response.bodyMode')}>
          {(['pretty', 'raw', 'preview'] as BodyMode[]).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={effective === m}
              className={effective === m ? 'active' : ''}
              disabled={(m === 'pretty' && res.isLarge) || (m === 'preview' && !canPreview)}
              onClick={() => setMode(m)}
            >
              {t(`response.mode.${m}`)}
            </button>
          ))}
        </div>
        <span className="spacer" />
        {effective !== 'preview' && (
          <button
            type="button"
            className="icon-btn"
            onClick={() => viewRef.current && openSearchPanel(viewRef.current)}
            title={`${t('response.search')} (Ctrl+F)`}
            aria-label={t('response.search')}
          >
            <Icon name="search" />
          </button>
        )}
        <button
          type="button"
          className="icon-btn"
          onClick={() => void copy()}
          title={t('response.copy')}
          aria-label={t('response.copy')}
        >
          <Icon name="copy" />
        </button>
        <button
          type="button"
          className="icon-btn"
          onClick={() => void save()}
          title={t('response.save')}
          aria-label={t('response.save')}
        >
          <Icon name="download" />
        </button>
      </div>

      {res.isLarge && (
        <div className="notice warning" role="status">
          <Icon name="warning" size={14} /> {t('response.largeNotice', { size: formatBytes(res.sizeBytes) })}
          <button type="button" className="btn btn-small" onClick={() => void save()}>
            {t('response.save')}
          </button>
        </div>
      )}
      {res.truncated && !res.isLarge && (
        <div className="notice" role="status">
          {t('response.truncated')}
        </div>
      )}

      <div className="response-content">
        {effective === 'pretty' && pretty && (
          <CodeEditor
            full
            readOnly
            language={pretty.lang}
            value={pretty.text}
            ariaLabel={t('response.body')}
            onView={(v) => (viewRef.current = v)}
            testId="response-body"
          />
        )}
        {effective === 'raw' && (
          <CodeEditor
            plain
            readOnly
            lineWrapping={!res.isLarge}
            value={res.bodyText}
            ariaLabel={t('response.body')}
            onView={(v) => (viewRef.current = v)}
            testId="response-body"
          />
        )}
        {effective === 'preview' &&
          (res.imageDataUrl ? (
            <div className="preview-image">
              <img src={res.imageDataUrl} alt={t('response.imagePreview')} />
            </div>
          ) : lang === 'html' ? (
            <iframe className="preview-frame" sandbox="" srcDoc={res.bodyText} title={t('response.htmlPreview')} />
          ) : (
            <p className="empty-hint">{t('response.noPreview')}</p>
          ))}
      </div>
    </div>
  )
}

export function ResponsePanel({
  response,
  sending
}: {
  response: HttpResult | null
  sending: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  const [view, setView] = useState<View>('body')

  if (sending) {
    return (
      <section className="response-panel empty" aria-label={t('response.title')} aria-busy="true">
        <div className="spinner" aria-hidden="true" />
        <p>{t('response.sending')}</p>
      </section>
    )
  }
  if (!response) {
    return (
      <section className="response-panel empty" aria-label={t('response.title')}>
        <Icon name="send" size={40} />
        <p className="empty-title">{t('response.emptyTitle')}</p>
        <p className="muted">{t('response.emptyHint')}</p>
      </section>
    )
  }
  if ('error' in response) {
    return (
      <section
        className="response-panel empty error"
        aria-label={t('response.title')}
        role="alert"
        data-testid="response-error"
      >
        <Icon name="warning" size={40} />
        <p className="empty-title">{t(`errors.${response.code}`)}</p>
        <p className="mono">{response.message}</p>
        {response.code === 'TLS' && <p className="muted">{t('errors.tlsHint')}</p>}
      </section>
    )
  }

  const cls = statusClass(response.status)
  return (
    <section className="response-panel" aria-label={t('response.title')}>
      <div className="response-meta" data-testid="response-meta">
        <span className={`status status-${cls}`} data-testid="response-status">
          {response.status} {response.statusText}
        </span>
        <span title={t('response.time')} data-testid="response-time">
          {formatDuration(response.durationMs)}
        </span>
        <span title={t('response.size')} data-testid="response-size">
          {formatBytes(response.sizeBytes)}
        </span>
        {response.redirects.length > 0 && (
          <span className="muted" title={response.redirects.join('\n')}>
            {t('response.redirects', { count: response.redirects.length })}
          </span>
        )}
      </div>
      <Tabs
        idPrefix="res"
        label={t('response.sections')}
        value={view}
        onChange={(v) => setView(v as View)}
        items={[
          { id: 'body', label: t('response.body') },
          { id: 'headers', label: `${t('response.headers')} (${response.headers.length})` },
          { id: 'cookies', label: `${t('response.cookies')} (${response.cookies.length})` },
          { id: 'timeline', label: t('response.timeline') }
        ]}
      />
      <div className="response-section" role="tabpanel" id={`res-panel-${view}`} aria-labelledby={`res-tab-${view}`}>
        {view === 'body' && <ResponseBody key={response.responseId} res={response} />}
        {view === 'headers' && (
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">{t('kv.key')}</th>
                <th scope="col">{t('kv.value')}</th>
              </tr>
            </thead>
            <tbody>
              {response.headers.map(([k, v], i) => (
                <tr key={`${k}-${i}`}>
                  <td className="mono">{k}</td>
                  <td className="mono break">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {view === 'cookies' &&
          (response.cookies.length === 0 ? (
            <p className="empty-hint">{t('response.noCookies')}</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">{t('cookies.name')}</th>
                  <th scope="col">{t('cookies.value')}</th>
                  <th scope="col">{t('cookies.domain')}</th>
                  <th scope="col">{t('cookies.path')}</th>
                  <th scope="col">{t('cookies.expires')}</th>
                  <th scope="col">{t('cookies.flags')}</th>
                </tr>
              </thead>
              <tbody>
                {response.cookies.map((c, i) => (
                  <tr key={`${c.name}-${i}`}>
                    <td className="mono">{c.name}</td>
                    <td className="mono break">{c.value}</td>
                    <td>{c.domain ?? '—'}</td>
                    <td>{c.path ?? '—'}</td>
                    <td>{c.expires ?? (c.maxAge ? `max-age=${c.maxAge}` : t('cookies.session'))}</td>
                    <td>
                      {[c.httpOnly && 'HttpOnly', c.secure && 'Secure', c.sameSite && `SameSite=${c.sameSite}`]
                        .filter(Boolean)
                        .join(', ') || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ))}
        {view === 'timeline' && <Timeline phases={response.timeline} total={response.durationMs} />}
      </div>
    </section>
  )
}
