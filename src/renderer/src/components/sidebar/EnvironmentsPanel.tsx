import { useTranslation } from 'react-i18next'
import { setActiveEnvironment } from '../../actions'
import { api } from '../../api'
import { confirmDialog, promptDialog } from '../../store/dialogs'
import { useData } from '../../store/data'
import { useUi } from '../../store/ui'
import { Icon } from '../Icon'

export function EnvironmentsPanel({ query }: { query: string }): React.JSX.Element {
  const { t } = useTranslation()
  const environments = useData((s) => s.environments)
  const loadEnvironments = useData((s) => s.loadEnvironments)
  const loadHints = useData((s) => s.loadHints)
  const fail = useUi((s) => s.fail)
  const openVariables = useUi((s) => s.openVariables)
  const q = query.trim().toLowerCase()
  const list = q ? environments.filter((e) => e.name.toLowerCase().includes(q)) : environments

  const run = async (fn: () => Promise<unknown>): Promise<void> => {
    try {
      await fn()
      await Promise.all([loadEnvironments(), loadHints()])
    } catch (err) {
      fail(err)
    }
  }

  const create = async (): Promise<void> => {
    const name = await promptDialog({ title: t('env.create'), label: t('common.name'), initial: 'dev' })
    if (!name) return
    await run(async () => {
      const { id } = await api.environments.create({ name })
      openVariables({ scope: 'environment', scopeId: id })
    })
  }

  const menu = async (id: string, name: string): Promise<void> => {
    const choice = await api.menu.popup({
      items: [
        { id: 'edit', label: t('env.editVariables') },
        { id: 'rename', label: t('common.rename') },
        { id: 'sep', label: '', type: 'separator' },
        { id: 'delete', label: t('common.delete') }
      ]
    })
    if (choice === 'edit') openVariables({ scope: 'environment', scopeId: id })
    else if (choice === 'rename') {
      const next = await promptDialog({ title: t('common.rename'), label: t('common.name'), initial: name })
      if (next && next !== name) await run(() => api.environments.rename({ id, name: next }))
    } else if (choice === 'delete') {
      const ok = await confirmDialog({
        title: t('common.delete'),
        message: t('env.confirmDelete', { name }),
        confirmText: t('common.delete'),
        danger: true
      })
      if (ok) await run(() => api.environments.delete({ id }))
    }
  }

  return (
    <div className="environments">
      <div className="panel-actions">
        <button
          type="button"
          className="btn btn-small"
          onClick={() => openVariables({ scope: 'global', scopeId: null })}
        >
          <Icon name="env" size={14} /> {t('env.globals')}
        </button>
        <button type="button" className="btn btn-small" onClick={() => void create()} data-testid="env-create">
          <Icon name="plus" size={14} /> {t('env.create')}
        </button>
      </div>
      {environments.length === 0 ? (
        <div className="empty-state small">
          <Icon name="env" size={32} />
          <p className="empty-title">{t('env.emptyTitle')}</p>
          <p className="muted">{t('env.emptyHint', { example: '{{baseUrl}}' })}</p>
        </div>
      ) : (
        <ul className="env-list" role="radiogroup" aria-label={t('env.active')}>
          {list.map((e) => (
            <li key={e.id} className={`env-item ${e.isActive ? 'active' : ''}`}>
              <label className="env-radio">
                <input
                  type="radio"
                  name="active-env"
                  checked={e.isActive}
                  onChange={() => void setActiveEnvironment(e.id)}
                />
                <span>{e.name}</span>
              </label>
              <button
                type="button"
                className="icon-btn"
                onClick={() => openVariables({ scope: 'environment', scopeId: e.id })}
                title={t('env.editVariables')}
                aria-label={t('env.editVariablesOf', { name: e.name })}
              >
                <Icon name="env" size={14} />
              </button>
              <button
                type="button"
                className="icon-btn"
                onClick={() => void menu(e.id, e.name)}
                aria-label={t('common.actions')}
              >
                <Icon name="more" size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
