import type { RequestDraft } from '../model'
import { autoContentType, hasHeader } from '../http-utils'

export function shellQuote(s: string): string {
  if (s !== '' && /^[A-Za-z0-9_@%+=:,./-]+$/.test(s)) return s
  return `'${s.replace(/'/g, `'\\''`)}'`
}

const DEFAULT_TIMEOUT = 30_000

export function generateCurl(draft: RequestDraft): string {
  const parts: string[] = []
  const method = draft.method.toUpperCase()
  const url = draft.url.trim()
  const body = draft.body

  const hasBody = body.type !== 'none'
  if (method === 'HEAD') parts.push('-I')
  else if (method !== 'GET' || (hasBody && method === 'GET')) {
    if (!(method === 'POST' && hasBody)) parts.push(`-X ${shellQuote(method)}`)
  }
  parts.unshift(`curl ${shellQuote(url)}`)

  for (const h of draft.headers) {
    if (!h.enabled || h.key.trim() === '') continue
    parts.push(`-H ${shellQuote(`${h.key}: ${h.value}`)}`)
  }
  const auto = autoContentType(body.type)
  if (auto && body.type !== 'urlencoded' && !hasHeader(draft.headers, 'content-type')) {
    parts.push(`-H ${shellQuote(`Content-Type: ${auto}`)}`)
  }

  switch (body.type) {
    case 'json':
    case 'text':
    case 'xml':
      if (body.raw !== '') parts.push(`--data-raw ${shellQuote(body.raw)}`)
      break
    case 'urlencoded':
      for (const p of body.urlencoded) {
        if (!p.enabled || p.key === '') continue
        parts.push(`--data-urlencode ${shellQuote(`${p.key}=${p.value}`)}`)
      }
      break
    case 'multipart':
      for (const f of body.multipart) {
        if (!f.enabled || f.key === '') continue
        if (f.kind === 'file') {
          for (const file of f.files) parts.push(`-F ${shellQuote(`${f.key}=@${file}`)}`)
        } else {
          parts.push(`--form-string ${shellQuote(`${f.key}=${f.value}`)}`)
        }
      }
      break
    case 'binary':
      if (body.binaryPath) parts.push(`--data-binary ${shellQuote(`@${body.binaryPath}`)}`)
      break
    default:
      break
  }

  if (draft.settings.followRedirects) parts.push('-L')
  if (!draft.settings.verifySsl) parts.push('-k')
  if (draft.settings.timeoutMs > 0 && draft.settings.timeoutMs !== DEFAULT_TIMEOUT) {
    parts.push(`--max-time ${draft.settings.timeoutMs / 1000}`)
  }
  return parts.join(' \\\n  ')
}
