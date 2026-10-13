import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { VariableInput, VariableScope } from '@shared/model'
import { newId } from '@shared/url-params'
import { api } from '../api'
import { useData } from '../store/data'
import { useUi } from '../store/ui'
import { Icon } from './Icon'
import { Modal } from './Modal'

interface Row {
  id: string
  persisted: boolean
  key: string
  value: string | undefined
  isSecret: boolean
  hasValue: boolean
}

export function VariablesModal(): React.JSX.Element | null {
  const { t } = useTranslation()
  const target = useUi((s) => s.variables)
  const openVariables = useUi((s) => s.openVariables)
  const fail = useUi((s) => s.fail)
  const toast = useUi((s) => s.toast)
  const secretAvailable = useUi((s) => s.info.secretStorageAvailable)
  const environments = useData((s) => s.environments)
  const tree = useData((s) => s.tree)
  const loadHints = useData((s) => s.loadHints)
  const [rows, setRows] = useState<Row[] | null>(null)
  const [reveal, setReveal] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!target) return
    setRows(null)
    setReveal(new Set())
    api.variables
      .list(target)
      .then((list) =>
        setRows(
          list.map((v) => ({
            id: v.id,
            persisted: true,
            key: v.key,
            value: v.isSecret ? undefined : (v.value ?? ''),
            isSecret: v.isSecret,
            hasValue: v.hasValue
          }))
        )
      )
      .catch((err: unknown) => {
        fail(err)
        openVariables(null)
      })
  }, [target, fail, openVariables])

  if (!target) return null

  const scopes: { scope: VariableScope; scopeId: string | null; label: string }[] = [
    { scope: 'global', scopeId: null, label: t('variables.scope.global') },
    ...environments.map((e) => ({
      scope: 'environment' as const,
      scopeId: e.id,
      label: `${t('variables.scope.environment')}: ${e.name}`
    })),
    ...tree.map((c) => ({
      scope: 'collection' as const,
      scopeId: c.id,
      label: `${t('variables.scope.collection')}: ${c.name}`
    }))
  ]
  const currentIdx = scopes.findIndex((s) => s.scope === target.scope && s.scopeId === target.scopeId)

  const update = (id: string, patch: Partial<Row>): void =>
    setRows((rs) => rs?.map((r) => (r.id === id ? { ...r, ...patch } : r)) ?? rs)

  const duplicates = new Set(
    (rows ?? []).map((r) => r.key.trim()).filter((k, i, arr) => k !== '' && arr.indexOf(k) !== i)
  )

  const save = async (): Promise<void> => {
    if (!rows) return
    if (duplicates.size > 0) {
      toast('error', t('variables.duplicate', { names: [...duplicates].join(', ') }))
      return
    }
    const input: VariableInput[] = rows
      .filter((r) => r.key.trim() !== '')
      .map((r) => ({
        id: r.persisted ? r.id : undefined,
        key: r.key.trim(),
        value: r.value,
        isSecret: r.isSecret
      }))
    setSaving(true)
    try {
      await api.variables.save({ ...target, variables: input })
      await loadHints()
      toast('success', t('variables.saved'))
      openVariables(null)
    } catch (err) {
      fail(err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      wide
      title={t('variables.title')}
      onClose={() => openVariables(null)}
      testId="variables-modal"
      footer={
        <>
          <span className="muted small">{t('variables.precedence')}</span>
          <span className="spacer" />
          <button type="button" className="btn" onClick={() => openVariables(null)}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void save()}
            disabled={saving || !rows}
            data-testid="variables-save"
          >
            {t('common.save')}
          </button>
        </>
      }
    >
      <label className="field inline">
        <span>{t('variables.scopeLabel')}</span>
        <select
          className="input"
          value={currentIdx}
          onChange={(e) => {
            const s = scopes[Number(e.target.value)]
            openVariables({ scope: s.scope, scopeId: s.scopeId })
          }}
        >
          {scopes.map((s, i) => (
            <option key={`${s.scope}-${s.scopeId ?? 'g'}`} value={i}>
              {s.label}
            </option>
          ))}
        </select>
      </label>

      {!secretAvailable && <div className="notice warning">{t('secrets.unavailable')}</div>}

      {rows === null ? (
        <div className="spinner" aria-label={t('common.loading')} />
      ) : (
        <table className="data-table vars-table">
          <thead>
            <tr>
              <th scope="col">{t('variables.name')}</th>
              <th scope="col">{t('variables.value')}</th>
              <th scope="col">{t('variables.secret')}</th>
              <th scope="col">
                <span className="sr-only">{t('common.actions')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id}>
                <td>
                  <input
                    className={`input mono ${duplicates.has(r.key.trim()) ? 'invalid' : ''}`}
                    value={r.key}
                    placeholder="baseUrl"
                    aria-label={t('variables.nameRow', { n: i + 1 })}
                    onChange={(e) => update(r.id, { key: e.target.value })}
                    data-testid="var-key"
                  />
                </td>
                <td>
                  {r.isSecret ? (
                    <span className="secret-input">
                      <input
                        className="input mono"
                        type={reveal.has(r.id) ? 'text' : 'password'}
                        value={r.value ?? ''}
                        placeholder={r.hasValue && r.value === undefined ? t('variables.secretKeep') : ''}
                        aria-label={t('variables.valueRow', { n: i + 1 })}
                        onChange={(e) => update(r.id, { value: e.target.value })}
                        autoComplete="off"
                        data-testid="var-value"
                      />
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label={reveal.has(r.id) ? t('variables.hide') : t('variables.show')}
                        onClick={() =>
                          setReveal((s) => {
                            const n = new Set(s)
                            if (n.has(r.id)) n.delete(r.id)
                            else n.add(r.id)
                            return n
                          })
                        }
                      >
                        <Icon name={reveal.has(r.id) ? 'eyeOff' : 'eye'} size={14} />
                      </button>
                    </span>
                  ) : (
                    <input
                      className="input mono"
                      value={r.value ?? ''}
                      aria-label={t('variables.valueRow', { n: i + 1 })}
                      onChange={(e) => update(r.id, { value: e.target.value })}
                      data-testid="var-value"
                    />
                  )}
                </td>
                <td className="center">
                  <input
                    type="checkbox"
                    checked={r.isSecret}
                    disabled={!secretAvailable && !r.isSecret}
                    aria-label={t('variables.secretRow', { n: i + 1 })}
                    onChange={(e) =>
                      update(r.id, {
                        isSecret: e.target.checked,
                        value: e.target.checked ? r.value : (r.value ?? '')
                      })
                    }
                    data-testid="var-secret"
                  />
                </td>
                <td>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={t('kv.removeRow', { n: i + 1 })}
                    onClick={() => setRows((rs) => rs?.filter((x) => x.id !== r.id) ?? rs)}
                  >
                    <Icon name="trash" size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <button
        type="button"
        className="btn btn-small"
        onClick={() =>
          setRows((rs) => [
            ...(rs ?? []),
            { id: newId(), persisted: false, key: '', value: '', isSecret: false, hasValue: false }
          ])
        }
        data-testid="var-add"
      >
        <Icon name="plus" size={14} /> {t('variables.add')}
      </button>
    </Modal>
  )
}
