import { app, BrowserWindow, clipboard, dialog } from 'electron'
import { writeFile } from 'node:fs/promises'
import { generateCurl } from '../../../shared/curl/generate'
import { HISTORY_BODY_PREVIEW_BYTES } from '../../../shared/http-utils'
import type { RequestDraft } from '../../../shared/model'
import { mergeLayers, referencedVariables, resolveDraft, type VariableLayer } from '../../../shared/variables'
import { getDb, getStatus, getWorkspaceId } from '../../db/client'
import { loadVariableLayers, type ResolvedLayers } from '../../db/repos/environments'
import { addHistory } from '../../db/repos/history'
import { assertFileAllowed } from '../../file-access'
import { cancelHttp, responses, sendHttp } from '../../http/client'
import { t } from '../../i18n'
import { log } from '../../log'
import { redactSecrets, safeStorageCodec } from '../../secrets'
import { handle } from '../register'

async function layersFor(collectionId: string | null): Promise<ResolvedLayers> {
  if (!getStatus().connected) return { layers: [], sources: [], secretValues: [] }
  return loadVariableLayers(getDb(), getWorkspaceId(), collectionId, safeStorageCodec)
}

function truncateUtf8(text: string, maxBytes: number): string {
  const buf = Buffer.from(text, 'utf8')
  if (buf.length <= maxBytes) return text
  return buf
    .subarray(0, maxBytes)
    .toString('utf8')
    .replace(/\uFFFD$/, '')
}

const EXT_BY_TYPE: Record<string, string> = {
  'application/json': 'json',
  'text/html': 'html',
  'application/xml': 'xml',
  'text/xml': 'xml',
  'text/plain': 'txt',
  'text/csv': 'csv',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
  'application/javascript': 'js',
  'text/css': 'css'
}

export function registerHttpHandlers(): void {
  handle('http:send', async ({ requestId, draft, collectionId }) => {
    const vars = await layersFor(collectionId)
    const { draft: resolved } = resolveDraft(draft, mergeLayers(vars.layers))
    const result = await sendHttp({
      requestId,
      draft: resolved,
      fileGuard: assertFileAllowed,
      userAgent: `Restless/${app.getVersion()}`
    })

    if (getStatus().connected) {
      // в историю — исходный (неразрешённый) черновик: `{{token}}` вместо значения секрета
      const isError = 'error' in result
      void addHistory(getDb(), {
        draft,
        status: isError ? null : result.status,
        durationMs: result.durationMs,
        sizeBytes: isError ? null : result.sizeBytes,
        responseHeaders: isError
          ? []
          : result.headers.map(([k, v]) => [k, redactSecrets(v, vars.secretValues)] as [string, string]),
        responseBodyPreview: redactSecrets(
          isError ? `${result.code}: ${result.message}` : truncateUtf8(result.bodyText, HISTORY_BODY_PREVIEW_BYTES),
          vars.secretValues
        )
      }).catch((err: Error) => log.error('history write failed:', err.message))
    }
    return result
  })

  handle('http:cancel', ({ requestId }) => cancelHttp(requestId))

  handle('http:saveBody', async ({ responseId }, event) => {
    const item = responses.get(responseId)
    if (!item) throw new Error('Response is no longer available, send the request again')
    const mime = item.contentType.split(';')[0].trim().toLowerCase()
    const ext = EXT_BY_TYPE[mime] ?? (mime.includes('json') ? 'json' : 'bin')
    const win = BrowserWindow.fromWebContents(event.sender)
    const opts = { defaultPath: `response.${ext}` }
    const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
    if (res.canceled || !res.filePath) return false
    await writeFile(res.filePath, item.body)
    return true
  })

  handle('http:copyBody', ({ responseId }) => {
    const item = responses.get(responseId)
    if (!item) return false
    clipboard.writeText(item.body.toString('utf8'))
    return true
  })

  handle('curl:copy', async ({ draft, collectionId }, event) => {
    const vars = await layersFor(collectionId)
    const refs = new Set(referencedVariables(draft))
    const secretRefs = vars.sources.flatMap((s) => [...s.secretKeys]).filter((k) => refs.has(k))
    let includeSecrets = false
    if (secretRefs.length > 0) {
      const win = BrowserWindow.fromWebContents(event.sender)
      const opts = {
        type: 'warning' as const,
        buttons: [t('curl.keepPlaceholders', { example: '{{…}}' }), t('curl.includeSecrets')],
        defaultId: 0,
        cancelId: 0,
        title: t('curl.secretsTitle'),
        message: t('curl.secretsTitle'),
        detail: t('curl.secretsDetail', { names: secretRefs.join(', ') })
      }
      const res = win ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts)
      includeSecrets = res.response === 1
    }
    const layers: VariableLayer[] = vars.layers.map((layer, i) => {
      if (includeSecrets) return layer
      const masked: VariableLayer = { ...layer }
      // секрет остаётся плейсхолдером: `{{x}}` → `{{x}}` (цикл детектируется и не раскрывается)
      for (const k of vars.sources[i]?.secretKeys ?? []) masked[k] = `{{${k}}}`
      return masked
    })
    const { draft: resolved } = resolveDraft(draft as RequestDraft, mergeLayers(layers))
    clipboard.writeText(generateCurl(resolved))
    return { copied: true, includedSecrets: includeSecrets }
  })
}
