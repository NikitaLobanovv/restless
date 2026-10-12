import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { flattenContainers, useData } from '../store/data'
import { useDialogs, type ConfirmRequest, type PromptRequest, type SaveAsRequest } from '../store/dialogs'
import { Modal } from './Modal'

function PromptDialog({ req, close }: { req: PromptRequest; close: () => void }): React.JSX.Element {
  const { t } = useTranslation()
  const [value, setValue] = useState(req.initial ?? '')
  const finish = (v: string | null): void => {
    close()
    req.resolve(v === null ? null : v.trim() || null)
  }
  return (
    <Modal
      title={req.title}
      onClose={() => finish(null)}
      testId="prompt-dialog"
      footer={
        <>
          <button type="button" className="btn" onClick={() => finish(null)}>
            {t('common.cancel')}
          </button>
          <button type="submit" form="prompt-form" className="btn btn-primary" data-testid="prompt-ok">
            {req.confirmText ?? t('common.ok')}
          </button>
        </>
      }
    >
      <form
        id="prompt-form"
        onSubmit={(e) => {
          e.preventDefault()
          finish(value)
        }}
      >
        <label className="field">
          {req.label && <span>{req.label}</span>}
          {req.multiline ? (
            <textarea
              className="input mono"
              rows={8}
              value={value}
              autoFocus
              onChange={(e) => setValue(e.target.value)}
              data-testid="prompt-input"
            />
          ) : (
            <input
              className="input"
              value={value}
              autoFocus
              onFocus={(e) => e.target.select()}
              onChange={(e) => setValue(e.target.value)}
              maxLength={200}
              data-testid="prompt-input"
            />
          )}
        </label>
      </form>
    </Modal>
  )
}

function ConfirmDialog({ req, close }: { req: ConfirmRequest; close: () => void }): React.JSX.Element {
  const { t } = useTranslation()
  const finish = (ok: boolean): void => {
    close()
    req.resolve(ok)
  }
  return (
    <Modal
      title={req.title}
      onClose={() => finish(false)}
      testId="confirm-dialog"
      footer={
        <>
          <button type="button" className="btn" onClick={() => finish(false)} autoFocus>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className={`btn ${req.danger ? 'btn-danger' : 'btn-primary'}`}
            onClick={() => finish(true)}
            data-testid="confirm-ok"
          >
            {req.confirmText ?? t('common.ok')}
          </button>
        </>
      }
    >
      <p>{req.message}</p>
    </Modal>
  )
}

function SaveAsDialog({ req, close }: { req: SaveAsRequest; close: () => void }): React.JSX.Element {
  const { t } = useTranslation()
  const tree = useData((s) => s.tree)
  const containers = flattenContainers(tree)
  const [name, setName] = useState(req.draft.name || t('request.newName'))
  const [target, setTarget] = useState(0)
  const finish = (ok: boolean): void => {
    close()
    const c = containers[target]
    req.resolve(
      ok && c && name.trim() ? { collectionId: c.collectionId, folderId: c.folderId, name: name.trim() } : null
    )
  }
  return (
    <Modal
      title={t('request.saveAs')}
      onClose={() => finish(false)}
      testId="save-dialog"
      footer={
        <>
          <button type="button" className="btn" onClick={() => finish(false)}>
            {t('common.cancel')}
          </button>
          <button type="submit" form="save-form" className="btn btn-primary" data-testid="save-ok">
            {t('request.save')}
          </button>
        </>
      }
    >
      <form
        id="save-form"
        onSubmit={(e) => {
          e.preventDefault()
          finish(true)
        }}
      >
        <label className="field">
          <span>{t('common.name')}</span>
          <input
            className="input"
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            maxLength={200}
            data-testid="save-name"
          />
        </label>
        <label className="field">
          <span>{t('request.saveTo')}</span>
          <select
            className="input"
            value={target}
            onChange={(e) => setTarget(Number(e.target.value))}
            data-testid="save-target"
          >
            {containers.map((c, i) => (
              <option key={`${c.collectionId}-${c.folderId ?? 'root'}`} value={i}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
      </form>
    </Modal>
  )
}

export function Dialogs(): React.JSX.Element | null {
  const current = useDialogs((s) => s.current)
  const close = useDialogs((s) => s.close)
  if (!current) return null
  if (current.kind === 'prompt') return <PromptDialog key={current.title} req={current} close={close} />
  if (current.kind === 'confirm') return <ConfirmDialog req={current} close={close} />
  return <SaveAsDialog req={current} close={close} />
}
