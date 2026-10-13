import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../api'
import { useUi } from '../store/ui'
import { Icon } from './Icon'

export function ConnectionScreen({ onConnected }: { onConnected: () => void }): React.JSX.Element {
  const { t } = useTranslation()
  const db = useUi((s) => s.db)
  const setDb = useUi((s) => s.setDb)
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)

  const check = async (): Promise<void> => {
    setBusy(true)
    try {
      const status = url.trim() ? await api.db.connect({ url: url.trim() }) : await api.db.retry()
      setDb(status)
      if (status.connected) {
        setUrl('')
        onConnected()
      }
    } catch (err) {
      setDb({ connected: false, error: (err as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="connection-screen">
      <div className="connection-card">
        <Icon name="database" size={40} />
        <h1>{t('db.title')}</h1>
        <p className="muted">{t('db.description')}</p>
        {db?.error && (
          <div className="notice error" role="alert" data-testid="db-error">
            {db.error}
          </div>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void check()
          }}
        >
          <label className="field">
            <span>{t('db.connectionString')}</span>
            <input
              className="input mono"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={url}
              placeholder="postgres://user:password@localhost:5432/restless"
              onChange={(e) => setUrl(e.target.value)}
              data-testid="db-url"
            />
            <small className="muted">{t('db.hint')}</small>
          </label>
          <button type="submit" className="btn btn-primary" disabled={busy} data-testid="db-check">
            {busy ? t('db.checking') : t('db.check')}
          </button>
        </form>
        <details>
          <summary>{t('db.howTo')}</summary>
          <pre className="mono small">make db{'\n'}make migrate</pre>
        </details>
      </div>
    </main>
  )
}
