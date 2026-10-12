import { useTranslation } from 'react-i18next'
import type { ThemeSource } from '@shared/model'
import { setActiveEnvironment } from '../actions'
import { useData } from '../store/data'
import { useUi } from '../store/ui'
import { Icon } from './Icon'

export function Header(): React.JSX.Element {
  const { t } = useTranslation()
  const environments = useData((s) => s.environments)
  const active = environments.find((e) => e.isActive)
  const openVariables = useUi((s) => s.openVariables)
  const theme = useUi((s) => s.config.theme)
  const layout = useUi((s) => s.config.responseLayout)
  const setConfig = useUi((s) => s.setConfig)
  const weak = useUi((s) => s.info.weakSecretStorage)

  return (
    <header className="app-header">
      <div className="brand" aria-hidden="true">
        <span className="brand-mark">R</span>
        <span className="brand-name">Restless</span>
      </div>
      <span className="spacer" />
      {weak && (
        <span className="badge warning" title={t('secrets.weakStorage')}>
          <Icon name="warning" size={12} /> {t('secrets.weakShort')}
        </span>
      )}
      <label className="env-select">
        <span className="sr-only">{t('env.active')}</span>
        <Icon name="env" size={14} />
        <select
          id="env-select"
          value={active?.id ?? ''}
          onChange={(e) => void setActiveEnvironment(e.target.value || null)}
          title={`${t('env.active')} (Ctrl+E)`}
          data-testid="env-select"
        >
          <option value="">{t('env.none')}</option>
          {environments.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="btn btn-small"
        onClick={() =>
          openVariables(active ? { scope: 'environment', scopeId: active.id } : { scope: 'global', scopeId: null })
        }
        data-testid="edit-variables"
      >
        {t('env.variables')}
      </button>
      <button
        type="button"
        className="icon-btn"
        onClick={() => void setConfig({ responseLayout: layout === 'right' ? 'bottom' : 'right' })}
        title={t('layout.toggle')}
        aria-label={t('layout.toggle')}
      >
        <Icon name={layout === 'right' ? 'layoutRight' : 'layoutBottom'} />
      </button>
      <label className="theme-select">
        <span className="sr-only">{t('menu.theme')}</span>
        <Icon name="sun" size={14} />
        <select value={theme} onChange={(e) => void setConfig({ theme: e.target.value as ThemeSource })}>
          {(['system', 'light', 'dark'] as ThemeSource[]).map((th) => (
            <option key={th} value={th}>
              {t(`theme.${th}`)}
            </option>
          ))}
        </select>
      </label>
    </header>
  )
}
