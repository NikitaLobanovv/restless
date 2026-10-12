import { emptyDraft, type FormField, type KeyValue, type RequestDraft } from '../model'
import { newId, paramsFromUrl, parseQuery, splitUrl, urlWithParams } from '../url-params'

export class CurlParseError extends Error {}

/** Разбивает строку командной оболочки на аргументы (bash-подобные правила) */
export function tokenize(input: string): string[] {
  // переносы строк: bash `\`, cmd `^`, PowerShell `` ` ``
  const src = input
    .replace(/\\\r?\n/g, ' ')
    .replace(/\^\r?\n/g, ' ')
    .replace(/`\r?\n/g, ' ')
  const tokens: string[] = []
  let cur = ''
  let inToken = false
  let i = 0
  while (i < src.length) {
    const ch = src[i]
    if (/\s/.test(ch)) {
      if (inToken) {
        tokens.push(cur)
        cur = ''
        inToken = false
      }
      i++
      continue
    }
    inToken = true
    if (ch === "'") {
      const end = src.indexOf("'", i + 1)
      if (end < 0) throw new CurlParseError('Unterminated single quote')
      cur += src.slice(i + 1, end)
      i = end + 1
    } else if (ch === '$' && src[i + 1] === "'") {
      // ANSI-C quoting: $'...'
      i += 2
      while (i < src.length && src[i] !== "'") {
        if (src[i] === '\\' && i + 1 < src.length) {
          const n = src[i + 1]
          const map: Record<string, string> = { n: '\n', t: '\t', r: '\r', '\\': '\\', "'": "'", '"': '"', '0': '\0' }
          cur += map[n] ?? n
          i += 2
        } else {
          cur += src[i++]
        }
      }
      if (i >= src.length) throw new CurlParseError('Unterminated $-quote')
      i++
    } else if (ch === '"') {
      i++
      while (i < src.length && src[i] !== '"') {
        if (src[i] === '\\' && i + 1 < src.length && '"\\$`\n'.includes(src[i + 1])) {
          cur += src[i + 1]
          i += 2
        } else {
          cur += src[i++]
        }
      }
      if (i >= src.length) throw new CurlParseError('Unterminated double quote')
      i++
    } else if (ch === '\\' && i + 1 < src.length) {
      cur += src[i + 1]
      i += 2
    } else {
      cur += ch
      i++
    }
  }
  if (inToken) tokens.push(cur)
  return tokens
}

/** Опции, у которых есть значение (короткие → длинные) */
const SHORT_WITH_VALUE: Record<string, string> = {
  X: 'request',
  H: 'header',
  d: 'data',
  F: 'form',
  u: 'user',
  A: 'user-agent',
  b: 'cookie',
  e: 'referer',
  m: 'max-time',
  o: 'output',
  w: 'write-out',
  x: 'proxy',
  E: 'cert',
  c: 'cookie-jar',
  T: 'upload-file',
  K: 'config',
  U: 'proxy-user',
  Y: 'speed-limit',
  y: 'speed-time',
  z: 'time-cond',
  r: 'range',
  C: 'continue-at',
  P: 'ftp-port',
  t: 'telnet-option',
  Q: 'quote'
}
const SHORT_FLAGS: Record<string, string> = {
  k: 'insecure',
  L: 'location',
  I: 'head',
  G: 'get',
  s: 'silent',
  S: 'show-error',
  v: 'verbose',
  i: 'include',
  f: 'fail',
  N: 'no-buffer',
  '#': 'progress-bar',
  g: 'globoff',
  O: 'remote-name',
  J: 'remote-header-name',
  q: 'disable',
  '0': 'http1.0',
  '1': 'tlsv1',
  '2': 'sslv2',
  '3': 'sslv3',
  '4': 'ipv4',
  '6': 'ipv6',
  Z: 'parallel'
}
const LONG_WITH_VALUE = new Set([
  ...Object.values(SHORT_WITH_VALUE),
  'url',
  'data-raw',
  'data-binary',
  'data-ascii',
  'data-urlencode',
  'json',
  'form-string',
  'connect-timeout',
  'cacert',
  'capath',
  'key',
  'resolve',
  'retry',
  'retry-delay',
  'retry-max-time',
  'limit-rate',
  'max-redirs',
  'interface',
  'oauth2-bearer',
  'aws-sigv4',
  'proxy-header',
  'unix-socket',
  'dns-servers',
  'local-port',
  'request-target',
  'cert-type',
  'key-type',
  'pass',
  'ciphers',
  'tls-max',
  'expect100-timeout',
  'happy-eyeballs-timeout-ms',
  'keepalive-time',
  'variable',
  'url-query'
])

interface Opt {
  name: string
  value?: string
}

function readOptions(args: string[]): { opts: Opt[]; positional: string[] } {
  const opts: Opt[] = []
  const positional: string[] = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '--') {
      positional.push(...args.slice(i + 1))
      break
    }
    if (a.startsWith('--') && a.length > 2) {
      let name = a.slice(2)
      let value: string | undefined
      const eq = name.indexOf('=')
      if (eq > 0 && LONG_WITH_VALUE.has(name.slice(0, eq))) {
        value = name.slice(eq + 1)
        name = name.slice(0, eq)
      }
      if (LONG_WITH_VALUE.has(name) && value === undefined) {
        value = args[++i]
        if (value === undefined) throw new CurlParseError(`Option --${name} requires a value`)
      }
      opts.push({ name, value })
      continue
    }
    if (a.startsWith('-') && a.length > 1) {
      for (let j = 1; j < a.length; j++) {
        const c = a[j]
        const long = SHORT_WITH_VALUE[c]
        if (long) {
          let value = a.slice(j + 1)
          if (value === '') {
            value = args[++i]
            if (value === undefined) throw new CurlParseError(`Option -${c} requires a value`)
          }
          opts.push({ name: long, value })
          break
        }
        opts.push({ name: SHORT_FLAGS[c] ?? c })
      }
      continue
    }
    positional.push(a)
  }
  return { opts, positional }
}

function kv(key: string, value: string): KeyValue {
  return { id: newId(), key, value, description: '', enabled: true }
}

function base64Utf8(s: string): string {
  const bytes = new TextEncoder().encode(s)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

export function looksLikeCurl(text: string): boolean {
  return /^\s*curl(\.exe)?\s/i.test(text)
}

export function parseCurl(command: string): RequestDraft {
  const tokens = tokenize(command.trim())
  if (tokens.length === 0 || !/^curl(\.exe)?$/i.test(tokens[0])) {
    throw new CurlParseError('Not a curl command')
  }
  const { opts, positional } = readOptions(tokens.slice(1))
  const draft = emptyDraft()
  let method: string | null = null
  let url: string | null = null
  const headers: KeyValue[] = []
  const data: string[] = []
  const urlencoded: KeyValue[] = []
  const multipart: FormField[] = []
  let jsonBody = false
  let getMode = false
  let head = false

  for (const o of opts) {
    const v = o.value ?? ''
    switch (o.name) {
      case 'request':
        method = v.toUpperCase()
        break
      case 'url':
        url ??= v
        break
      case 'header': {
        const idx = v.indexOf(':')
        if (idx > 0) {
          const value = v.slice(idx + 1).trim()
          // `-H 'X;'` в curl означает пустое значение, `-H 'X:'` — удаление; сохраняем как пустое
          headers.push(kv(v.slice(0, idx).trim(), value))
        } else if (v.endsWith(';')) {
          headers.push(kv(v.slice(0, -1).trim(), ''))
        }
        break
      }
      case 'data':
      case 'data-ascii':
      case 'data-raw':
      case 'data-binary':
        data.push(o.name === 'data' || o.name === 'data-ascii' ? v.replace(/[\r\n]/g, '') : v)
        break
      case 'json':
        jsonBody = true
        data.push(v)
        break
      case 'data-urlencode': {
        const eq = v.indexOf('=')
        if (eq > 0) urlencoded.push(kv(v.slice(0, eq), v.slice(eq + 1)))
        else urlencoded.push(kv(eq === 0 ? v.slice(1) : v, ''))
        break
      }
      case 'form':
      case 'form-string': {
        const eq = v.indexOf('=')
        if (eq <= 0) break
        const key = v.slice(0, eq)
        let value = v.slice(eq + 1)
        // `;type=...` и прочие атрибуты отбрасываем
        if (o.name === 'form') {
          const semi = value.search(/;(type|filename|headers)=/)
          if (semi >= 0) value = value.slice(0, semi)
        }
        if (o.name === 'form' && (value.startsWith('@') || value.startsWith('<'))) {
          multipart.push({ ...kv(key, ''), kind: 'file', files: [value.slice(1)] })
        } else {
          multipart.push({ ...kv(key, value), kind: 'text', files: [] })
        }
        break
      }
      case 'user': {
        headers.push(kv('Authorization', `Basic ${base64Utf8(v.includes(':') ? v : `${v}:`)}`))
        break
      }
      case 'oauth2-bearer':
        headers.push(kv('Authorization', `Bearer ${v}`))
        break
      case 'user-agent':
        headers.push(kv('User-Agent', v))
        break
      case 'referer':
        headers.push(kv('Referer', v))
        break
      case 'cookie':
        if (v.includes('=')) headers.push(kv('Cookie', v))
        break
      case 'insecure':
        draft.settings.verifySsl = false
        break
      case 'location':
        draft.settings.followRedirects = true
        break
      case 'max-time': {
        const secs = Number(v)
        if (Number.isFinite(secs) && secs > 0) draft.settings.timeoutMs = Math.round(secs * 1000)
        break
      }
      case 'head':
        head = true
        break
      case 'get':
        getMode = true
        break
      case 'url-query': {
        const eq = v.indexOf('=')
        if (eq > 0) {
          const q = encodeURIComponent(v.slice(0, eq)) + '=' + encodeURIComponent(v.slice(eq + 1))
          data.push(q)
          getMode = true
        }
        break
      }
      default:
        break
    }
  }

  url ??= positional[0] ?? null
  if (!url) throw new CurlParseError('URL not found in curl command')

  if (jsonBody) {
    if (!headers.some((h) => h.key.toLowerCase() === 'content-type')) {
      headers.push(kv('Content-Type', 'application/json'))
    }
    if (!headers.some((h) => h.key.toLowerCase() === 'accept')) headers.push(kv('Accept', 'application/json'))
  }

  if (getMode && (data.length > 0 || urlencoded.length > 0)) {
    const extra = [
      ...data,
      ...urlencoded.map((p) => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`)
    ].join('&')
    const { query } = splitUrl(url)
    const existing = query ? parseQuery(query) : []
    url = urlWithParams(
      url,
      [...existing, ...parseQuery(extra)].map((p) => kv(p.key, p.value))
    )
    data.length = 0
    urlencoded.length = 0
  }

  const hasBody = data.length > 0 || urlencoded.length > 0 || multipart.length > 0
  draft.method = method ?? (head ? 'HEAD' : hasBody ? 'POST' : 'GET')
  draft.url = url
  draft.params = paramsFromUrl(url, [])
  draft.headers = headers

  if (multipart.length > 0) {
    draft.body.type = 'multipart'
    draft.body.multipart = multipart
  } else if (urlencoded.length > 0 && data.length === 0) {
    draft.body.type = 'urlencoded'
    draft.body.urlencoded = urlencoded
  } else if (data.length > 0) {
    const raw = [...data, ...urlencoded.map((p) => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`)].join(
      '&'
    )
    const ct = headers.find((h) => h.key.toLowerCase() === 'content-type')?.value.toLowerCase() ?? ''
    let isJson = ct.includes('json')
    if (!ct) {
      try {
        const parsed: unknown = JSON.parse(raw)
        isJson = typeof parsed === 'object' && parsed !== null
      } catch {
        isJson = false
      }
    }
    if (isJson) {
      draft.body.type = 'json'
      draft.body.raw = raw
    } else if (ct.includes('xml')) {
      draft.body.type = 'xml'
      draft.body.raw = raw
    } else if ((!ct || ct.includes('x-www-form-urlencoded')) && /^[^=&\s]+=[^&]*(&[^=&\s]+=[^&]*)*$/.test(raw)) {
      draft.body.type = 'urlencoded'
      draft.body.urlencoded = parseQuery(raw).map((p) => kv(p.key, p.value))
    } else {
      draft.body.type = 'text'
      draft.body.raw = raw
    }
  }

  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `http://${url}`)
    draft.name = `${draft.method} ${u.host}${u.pathname === '/' ? '' : u.pathname}`
  } catch {
    draft.name = `${draft.method} ${url}`.slice(0, 200)
  }
  return draft
}
