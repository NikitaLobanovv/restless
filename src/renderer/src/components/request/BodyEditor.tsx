import { useTranslation } from 'react-i18next'
import { validateJson } from '@shared/http-utils'
import { BODY_TYPES, type BodyType, type RequestBody } from '@shared/model'
import { api } from '../../api'
import { formatActiveBody } from '../../actions'
import { CodeEditor } from '../../editor/CodeEditor'
import { useUi } from '../../store/ui'
import { Icon } from '../Icon'
import { KeyValueTable } from '../KeyValueTable'

interface Props {
  body: RequestBody
  onChange: (body: RequestBody) => void
}

export function BodyEditor({ body, onChange }: Props): React.JSX.Element {
  const { t } = useTranslation()
  const fail = useUi((s) => s.fail)
  const jsonError = body.type === 'json' ? validateJson(body.raw) : null

  const pickBinary = async (): Promise<void> => {
    try {
      const [file] = await api.files.pick({ multiple: false })
      if (file) onChange({ ...body, binaryPath: file })
    } catch (err) {
      fail(err)
    }
  }

  return (
    <div className="body-editor">
      <div className="body-types" role="radiogroup" aria-label={t('body.type')}>
        {BODY_TYPES.map((type) => (
          <label key={type} className={`radio-chip ${body.type === type ? 'active' : ''}`}>
            <input
              type="radio"
              name="body-type"
              value={type}
              checked={body.type === type}
              onChange={() => onChange({ ...body, type: type as BodyType })}
            />
            {t(`body.types.${type}`)}
          </label>
        ))}
        {(body.type === 'json' || body.type === 'xml') && (
          <button type="button" className="btn btn-small body-format" onClick={formatActiveBody} title="Ctrl+Shift+F">
            {t('body.format')}
          </button>
        )}
      </div>

      {body.type === 'none' && <p className="empty-hint">{t('body.noneHint')}</p>}

      {(body.type === 'json' || body.type === 'text' || body.type === 'xml') && (
        <div className="body-raw">
          <CodeEditor
            full
            variables
            language={body.type === 'text' ? 'text' : body.type}
            value={body.raw}
            onChange={(raw) => raw !== body.raw && onChange({ ...body, raw })}
            ariaLabel={t('body.editor')}
            testId="body-editor"
          />
          {jsonError && (
            <div className="body-error" role="status">
              <Icon name="warning" size={14} /> {t('body.invalidJson', { message: jsonError })}
            </div>
          )}
        </div>
      )}

      {body.type === 'urlencoded' && (
        <KeyValueTable
          rows={body.urlencoded}
          onChange={(urlencoded) => onChange({ ...body, urlencoded })}
          ariaLabel={t('body.types.urlencoded')}
        />
      )}

      {body.type === 'multipart' && (
        <KeyValueTable
          rows={body.multipart}
          onChange={(multipart) => onChange({ ...body, multipart })}
          ariaLabel={t('body.types.multipart')}
          allowFiles
        />
      )}

      {body.type === 'binary' && (
        <div className="body-binary">
          <Icon name="file" />
          <span className="kv-files-names">{body.binaryPath ?? t('kv.noFile')}</span>
          <button type="button" className="btn btn-small" onClick={() => void pickBinary()}>
            {t('kv.chooseFile')}
          </button>
          {body.binaryPath && (
            <button type="button" className="btn btn-small" onClick={() => onChange({ ...body, binaryPath: null })}>
              {t('common.clear')}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
