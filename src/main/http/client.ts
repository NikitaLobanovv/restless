import { randomUUID } from 'node:crypto'
import dns from 'node:dns'
import net from 'node:net'
import tls from 'node:tls'
import { promisify } from 'node:util'
import zlib from 'node:zlib'
import { Agent, request, type buildConnector, type Dispatcher } from 'undici'
import { LARGE_RESPONSE_BYTES, hasHeader, isTextualContentType, parseSetCookie } from '../../shared/http-utils'
import type { HttpErrorData, HttpResult, RequestDraft, TimelinePhases } from '../../shared/model'
import { buildBody, type FileGuard } from './body'
import { ResponseStore } from './response-store'

/** Сколько текста отдаём в renderer (больше — только «Сохранить в файл») */
const MAX_TEXT_TO_RENDERER = 20 * 1024 * 1024
const MAX_IMAGE_PREVIEW = 10 * 1024 * 1024
/** Жёсткий предел тела, чтобы не уронить main-процесс */
const MAX_BODY_BYTES = 512 * 1024 * 1024
const MAX_REDIRECTS = 20

export const responses = new ResponseStore(20, 300 * 1024 * 1024)

const inflight = new Map<string, AbortController>()

interface Timing {
  start: number
  dnsStart?: number
  dnsEnd?: number
  tcpEnd?: number
  tlsEnd?: number
  headers?: number
  end?: number
}

const now = (): number => performance.now()

/**
 * Собственный connector undici: открывает сокет сам и фиксирует фазы
 * DNS / TCP / TLS первого соединения для вкладки Timeline.
 */
function timedConnector(t: Timing, verifySsl: boolean): buildConnector.connector {
  return (opts, cb) => {
    const first = t.tcpEnd === undefined
    const host = opts.hostname.replace(/^\[|\]$/g, '')
    const port = Number(opts.port) || (opts.protocol === 'https:' ? 443 : 80)
    const lookup: net.LookupFunction = (hostname, options, callback) => {
      if (first) t.dnsStart = now()
      dns.lookup(hostname, options, (err, address, family) => {
        if (first) t.dnsEnd = now()
        ;(callback as (e: Error | null, a: string | dns.LookupAddress[], f?: number) => void)(err, address, family)
      })
    }
    let done = false
    const finish = (err: Error | null, socket: net.Socket | null): void => {
      if (done) return
      done = true
      if (err) cb(err, null)
      else cb(null, socket as net.Socket)
    }
    let socket: net.Socket
    if (opts.protocol === 'https:') {
      const s = tls.connect({
        host,
        port,
        servername: net.isIP(host) ? undefined : (opts.servername ?? host),
        rejectUnauthorized: verifySsl,
        ALPNProtocols: ['http/1.1'],
        lookup: net.isIP(host) ? undefined : lookup
      })
      s.once('connect', () => {
        if (first) t.tcpEnd = now()
      })
      s.once('secureConnect', () => {
        if (first) t.tlsEnd = now()
        finish(null, s)
      })
      socket = s
    } else {
      socket = net.connect({ host, port, lookup: net.isIP(host) ? undefined : lookup })
      socket.once('connect', () => {
        if (first) t.tcpEnd = now()
        finish(null, socket)
      })
    }
    socket.setNoDelay(true)
    socket.once('error', (err) => finish(err, null))
  }
}

function timelineOf(t: Timing): TimelinePhases {
  const phases: TimelinePhases = {}
  if (t.dnsStart !== undefined && t.dnsEnd !== undefined) phases.dnsMs = t.dnsEnd - t.dnsStart
  const tcpStart = t.dnsEnd ?? t.start
  if (t.tcpEnd !== undefined) phases.tcpMs = t.tcpEnd - tcpStart
  if (t.tlsEnd !== undefined && t.tcpEnd !== undefined) phases.tlsMs = t.tlsEnd - t.tcpEnd
  const sent = t.tlsEnd ?? t.tcpEnd
  if (t.headers !== undefined && sent !== undefined) phases.ttfbMs = t.headers - sent
  if (t.end !== undefined && t.headers !== undefined) phases.downloadMs = t.end - t.headers
  return phases
}

const inflate = {
  gzip: promisify(zlib.gunzip),
  'x-gzip': promisify(zlib.gunzip),
  deflate: promisify(zlib.inflate),
  br: promisify(zlib.brotliDecompress)
} as const

async function decode(buf: Buffer, encoding: string | undefined): Promise<Buffer> {
  if (!encoding) return buf
  let out = buf
  // кодировки применяются по порядку, снимаем в обратном
  for (const enc of encoding
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .reverse()) {
    if (enc === 'identity' || enc === '') continue
    if (enc === 'deflate') {
      try {
        out = await inflate.deflate(out)
      } catch {
        out = await promisify(zlib.inflateRaw)(out)
      }
    } else if (enc in inflate) {
      out = await inflate[enc as keyof typeof inflate](out)
    } else if (enc === 'zstd' && 'zstdDecompress' in zlib) {
      out = await promisify((zlib as unknown as { zstdDecompress: typeof zlib.gunzip }).zstdDecompress)(out)
    } else {
      return buf
    }
  }
  return out
}

function charsetOf(ct: string): string {
  const m = /charset\s*=\s*"?([^";\s]+)/i.exec(ct)
  return m?.[1]?.toLowerCase() ?? 'utf-8'
}

function decodeText(buf: Buffer, ct: string): string {
  try {
    return new TextDecoder(charsetOf(ct)).decode(buf)
  } catch {
    return new TextDecoder('utf-8').decode(buf)
  }
}

function headerValue(h: Record<string, string | string[] | undefined>, name: string): string | undefined {
  const v = h[name]
  return Array.isArray(v) ? v.join(', ') : v
}

function flattenHeaders(h: Record<string, string | string[] | undefined>): [string, string][] {
  const out: [string, string][] = []
  for (const [k, v] of Object.entries(h)) {
    if (v === undefined) continue
    if (Array.isArray(v)) for (const item of v) out.push([k, item])
    else out.push([k, v])
  }
  return out
}

function classifyError(err: unknown, signal: AbortSignal, durationMs: number): HttpErrorData {
  const e = err as NodeJS.ErrnoException & { cause?: NodeJS.ErrnoException }
  const code = e?.code ?? e?.cause?.code ?? ''
  const message = e?.cause?.message ?? e?.message ?? String(err)
  if (signal.aborted) {
    const reason = signal.reason as Error | undefined
    if (reason?.name === 'TimeoutError')
      return { error: true, code: 'TIMEOUT', message: 'Request timed out', durationMs }
    return { error: true, code: 'CANCELLED', message: 'Request cancelled', durationMs }
  }
  if (code === 'FILE_NOT_ALLOWED' || e?.name === 'FileNotAllowedError') {
    return { error: true, code: 'FILE', message, durationMs }
  }
  if (code === 'ENOENT' || code === 'EACCES') return { error: true, code: 'FILE', message, durationMs }
  if (
    /CERT|SSL|TLS|SELF_SIGNED|UNABLE_TO_VERIFY|HOSTNAME_MISMATCH|ERR_TLS/i.test(code) ||
    /certificate/i.test(message)
  ) {
    return { error: true, code: 'TLS', message: `${code ? `${code}: ` : ''}${message}`, durationMs }
  }
  if (code === 'ERR_INVALID_URL' || e instanceof TypeError) {
    return { error: true, code: 'INVALID_URL', message, durationMs }
  }
  if (code) return { error: true, code: 'NETWORK', message: `${code}: ${message}`, durationMs }
  return { error: true, code: 'UNKNOWN', message, durationMs }
}

export interface SendOptions {
  requestId: string
  /** Черновик с уже подставленными переменными */
  draft: RequestDraft
  fileGuard: FileGuard
  userAgent: string
}

function normalizeUrl(raw: string): URL {
  const trimmed = raw.trim()
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`
  const url = new URL(withScheme)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw Object.assign(new TypeError(`Unsupported protocol ${url.protocol}`), { code: 'ERR_INVALID_URL' })
  }
  return url
}

export async function sendHttp(opts: SendOptions): Promise<HttpResult> {
  const { draft } = opts
  const controller = new AbortController()
  inflight.get(opts.requestId)?.abort()
  inflight.set(opts.requestId, controller)
  const signals = [controller.signal]
  if (draft.settings.timeoutMs > 0) signals.push(AbortSignal.timeout(draft.settings.timeoutMs))
  const signal = AbortSignal.any(signals)

  const t: Timing = { start: now() }
  const agent = new Agent({
    connect: timedConnector(t, draft.settings.verifySsl),
    pipelining: 0,
    keepAliveTimeout: 1
  })

  try {
    // URL — источник истины: включённые параметры таблицы синхронизированы с его query
    let url = normalizeUrl(draft.url)
    let method = draft.method.toUpperCase()
    let sendBody = true
    const redirects: string[] = []

    const baseHeaders: Record<string, string> = {}
    for (const h of draft.headers) {
      if (!h.enabled || h.key.trim() === '') continue
      const k = h.key.trim()
      baseHeaders[k] = k in baseHeaders ? `${baseHeaders[k]}, ${h.value}` : h.value
    }
    if (!hasHeader(draft.headers, 'user-agent')) baseHeaders['User-Agent'] = opts.userAgent
    if (!hasHeader(draft.headers, 'accept')) baseHeaders['Accept'] = '*/*'
    if (!hasHeader(draft.headers, 'accept-encoding')) baseHeaders['Accept-Encoding'] = 'gzip, deflate, br'

    for (;;) {
      const headers = { ...baseHeaders }
      let body: Awaited<ReturnType<typeof buildBody>>['body'] = null
      // как в Postman, тело допускается у любого метода, включая GET
      if (sendBody && draft.body.type !== 'none') {
        const built = await buildBody(draft.body, opts.fileGuard)
        body = built.body
        if (built.contentType && !hasHeader(draft.headers, 'content-type')) headers['Content-Type'] = built.contentType
      }

      const res = await request(url, {
        method: method as Dispatcher.HttpMethod,
        headers,
        body: body as never,
        dispatcher: agent,
        signal,
        headersTimeout: 0,
        bodyTimeout: 0
      })
      t.headers ??= now()

      const location = headerValue(res.headers, 'location')
      if (
        draft.settings.followRedirects &&
        [301, 302, 303, 307, 308].includes(res.statusCode) &&
        location &&
        redirects.length < MAX_REDIRECTS
      ) {
        await res.body.dump()
        redirects.push(url.toString())
        url = new URL(location, url)
        if (res.statusCode === 303 || ((res.statusCode === 301 || res.statusCode === 302) && method === 'POST')) {
          if (method !== 'HEAD') method = 'GET'
          sendBody = false
          for (const k of Object.keys(baseHeaders)) {
            if (k.toLowerCase() === 'content-type' || k.toLowerCase() === 'content-length') delete baseHeaders[k]
          }
        }
        // при переходе на другой origin не отправляем авторизацию и cookies
        if (url.origin !== new URL(redirects[redirects.length - 1]).origin) {
          for (const k of Object.keys(baseHeaders)) {
            if (['authorization', 'cookie', 'proxy-authorization'].includes(k.toLowerCase())) delete baseHeaders[k]
          }
        }
        continue
      }

      const chunks: Buffer[] = []
      let received = 0
      for await (const chunk of res.body) {
        const b = chunk as Buffer
        received += b.length
        if (received > MAX_BODY_BYTES) {
          controller.abort()
          throw Object.assign(new Error(`Response exceeds ${MAX_BODY_BYTES / 1024 / 1024} MB limit`), {
            code: 'ETOOBIG'
          })
        }
        chunks.push(b)
      }
      t.end = now()
      const raw = Buffer.concat(chunks)
      const encoding = headerValue(res.headers, 'content-encoding')
      let decoded: Buffer
      try {
        decoded = await decode(raw, encoding)
      } catch {
        decoded = raw
      }
      const contentType = headerValue(res.headers, 'content-type') ?? ''
      const responseId = randomUUID()
      responses.put(responseId, decoded, contentType)

      const isImage = /^image\//i.test(contentType)
      const textual = isTextualContentType(contentType) || (!isImage && !contentType)
      let bodyText = ''
      let truncated = false
      if (textual || !isImage) {
        if (textual) {
          const slice = decoded.length > MAX_TEXT_TO_RENDERER ? decoded.subarray(0, MAX_TEXT_TO_RENDERER) : decoded
          truncated = slice.length < decoded.length
          bodyText = decodeText(slice, contentType)
        } else {
          bodyText = decodeText(decoded.subarray(0, Math.min(decoded.length, 64 * 1024)), contentType)
          truncated = decoded.length > 64 * 1024
        }
      }
      const imageDataUrl =
        isImage && decoded.length <= MAX_IMAGE_PREVIEW
          ? `data:${contentType.split(';')[0]};base64,${decoded.toString('base64')}`
          : null

      const headerList = flattenHeaders(res.headers)
      const setCookies = headerList.filter(([k]) => k.toLowerCase() === 'set-cookie').map(([, v]) => v)
      return {
        responseId,
        status: res.statusCode,
        statusText: res.statusText ?? '',
        url: url.toString(),
        headers: headerList,
        cookies: setCookies.map(parseSetCookie).filter((c) => c !== null),
        durationMs: t.end - t.start,
        sizeBytes: raw.length,
        contentType,
        bodyText,
        imageDataUrl,
        isLarge: decoded.length > LARGE_RESPONSE_BYTES,
        truncated,
        timeline: timelineOf(t),
        redirects
      }
    }
  } catch (err) {
    return classifyError(err, signal, now() - t.start)
  } finally {
    inflight.delete(opts.requestId)
    void agent.close().catch(() => undefined)
  }
}

export function cancelHttp(requestId: string): void {
  inflight.get(requestId)?.abort()
}
