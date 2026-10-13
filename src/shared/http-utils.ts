import type { BodyType, KeyValue, ResponseCookie } from './model'

export const LARGE_RESPONSE_BYTES = 5 * 1024 * 1024
export const HISTORY_BODY_PREVIEW_BYTES = 100 * 1024
export const HISTORY_LIMIT = 1000

export function autoContentType(type: BodyType): string | null {
  switch (type) {
    case 'json':
      return 'application/json'
    case 'xml':
      return 'application/xml'
    case 'text':
      return 'text/plain'
    case 'urlencoded':
      return 'application/x-www-form-urlencoded'
    case 'binary':
      return 'application/octet-stream'
    default:
      return null
  }
}

export function hasHeader(headers: KeyValue[], name: string): boolean {
  const lower = name.toLowerCase()
  return headers.some((h) => h.enabled && h.key.trim().toLowerCase() === lower)
}

export function statusClass(status: number): 'info' | 'success' | 'redirect' | 'client' | 'server' {
  if (status >= 500) return 'server'
  if (status >= 400) return 'client'
  if (status >= 300) return 'redirect'
  if (status >= 200) return 'success'
  return 'info'
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 2 : 1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`
  return `${(ms / 1000).toFixed(2)} s`
}

export function parseSetCookie(header: string): ResponseCookie | null {
  const parts = header.split(';').map((p) => p.trim())
  const first = parts.shift()
  if (!first) return null
  const eq = first.indexOf('=')
  if (eq <= 0) return null
  const cookie: ResponseCookie = {
    name: first.slice(0, eq).trim(),
    value: first.slice(eq + 1).trim(),
    httpOnly: false,
    secure: false
  }
  for (const attr of parts) {
    const i = attr.indexOf('=')
    const k = (i < 0 ? attr : attr.slice(0, i)).trim().toLowerCase()
    const v = i < 0 ? '' : attr.slice(i + 1).trim()
    if (k === 'domain') cookie.domain = v
    else if (k === 'path') cookie.path = v
    else if (k === 'expires') cookie.expires = v
    else if (k === 'max-age') cookie.maxAge = v
    else if (k === 'httponly') cookie.httpOnly = true
    else if (k === 'secure') cookie.secure = true
    else if (k === 'samesite') cookie.sameSite = v
  }
  return cookie
}

export function isTextualContentType(ct: string): boolean {
  const c = ct.toLowerCase()
  return (
    c === '' ||
    c.startsWith('text/') ||
    c.includes('json') ||
    c.includes('xml') ||
    c.includes('javascript') ||
    c.includes('x-www-form-urlencoded') ||
    c.includes('graphql') ||
    c.includes('yaml') ||
    c.includes('csv')
  )
}

export function bodyLanguage(ct: string, body: string): 'json' | 'xml' | 'html' | 'text' {
  const c = ct.toLowerCase()
  if (c.includes('json')) return 'json'
  if (c.includes('html')) return 'html'
  if (c.includes('xml')) return 'xml'
  const t = body.trimStart()
  if (t.startsWith('{') || t.startsWith('[')) {
    try {
      JSON.parse(body)
      return 'json'
    } catch {
      return 'text'
    }
  }
  if (t.startsWith('<')) return /^<!doctype html|^<html/i.test(t) ? 'html' : 'xml'
  return 'text'
}

export function formatJson(text: string, indent = 2): string {
  return JSON.stringify(JSON.parse(text), null, indent)
}

export function validateJson(text: string): string | null {
  if (text.trim() === '') return null
  try {
    JSON.parse(text)
    return null
  } catch (e) {
    return (e as Error).message
  }
}

export function formatXml(xml: string, indent = '  '): string {
  const tokens = xml
    .replace(/>\s+</g, '><')
    .trim()
    .split(/(?=<)|(?<=>)/g)
    .map((t) => t.trim())
    .filter((t) => t !== '')
  const isOpening = (t: string): boolean => /^<[^/!?]/.test(t) && !t.endsWith('/>')
  const isClosing = (t: string): boolean => t.startsWith('</')
  let depth = 0
  const lines: string[] = []
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]
    if (isOpening(tok) && i + 2 < tokens.length && !tokens[i + 1].startsWith('<') && isClosing(tokens[i + 2])) {
      lines.push(indent.repeat(depth) + tok + tokens[i + 1] + tokens[i + 2])
      i += 2
      continue
    }
    if (isClosing(tok)) depth = Math.max(0, depth - 1)
    lines.push(indent.repeat(depth) + tok)
    if (isOpening(tok)) depth++
  }
  return lines.join('\n')
}
