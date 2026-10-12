import type { KeyValue } from './model'

let counter = 0
export function newId(): string {
  const c = globalThis.crypto
  if (c?.randomUUID) return c.randomUUID()
  counter += 1
  return `id-${Date.now().toString(36)}-${counter}`
}

/** Мягкое декодирование: битые %-последовательности и `{{var}}` остаются как есть */
function decode(s: string): string {
  try {
    return decodeURIComponent(s.replace(/\+/g, ' '))
  } catch {
    return s
  }
}

/** Кодирует значение параметра, не трогая шаблоны `{{...}}` */
export function encodeParam(s: string): string {
  return s
    .split(/(\{\{[^{}]*\}\})/g)
    .map((part) =>
      part.startsWith('{{') && part.endsWith('}}')
        ? part
        : encodeURIComponent(part)
            .replace(/%2F/gi, '/')
            .replace(/%3A/gi, ':')
            .replace(/%40/g, '@')
            .replace(/%2C/gi, ',')
    )
    .join('')
}

export function splitUrl(url: string): { base: string; query: string | null; hash: string } {
  let rest = url
  let hash = ''
  const hashIdx = rest.indexOf('#')
  if (hashIdx >= 0) {
    hash = rest.slice(hashIdx)
    rest = rest.slice(0, hashIdx)
  }
  const qIdx = rest.indexOf('?')
  if (qIdx < 0) return { base: rest, query: null, hash }
  return { base: rest.slice(0, qIdx), query: rest.slice(qIdx + 1), hash }
}

export function parseQuery(query: string): { key: string; value: string }[] {
  if (!query) return []
  return query
    .split('&')
    .filter((p) => p.length > 0)
    .map((pair) => {
      const eq = pair.indexOf('=')
      if (eq < 0) return { key: decode(pair), value: '' }
      return { key: decode(pair.slice(0, eq)), value: decode(pair.slice(eq + 1)) }
    })
}

export function buildQuery(params: { key: string; value: string; enabled?: boolean }[]): string {
  return params
    .filter((p) => p.enabled !== false && (p.key !== '' || p.value !== ''))
    .map((p) => (p.value === '' ? encodeParam(p.key) : `${encodeParam(p.key)}=${encodeParam(p.value)}`))
    .join('&')
}

/**
 * URL → таблица. Включённые строки заменяются строками из URL (с сохранением
 * id и описаний по позиции), выключенные строки таблицы остаются на месте.
 */
export function paramsFromUrl(url: string, current: KeyValue[]): KeyValue[] {
  const { query } = splitUrl(url)
  const parsed = query === null ? [] : parseQuery(query)
  const enabledOld = current.filter((p) => p.enabled)
  const fromUrl: KeyValue[] = parsed.map((p, i) => {
    const prev = enabledOld[i]
    return {
      id: prev?.id ?? newId(),
      key: p.key,
      value: p.value,
      description: prev?.description ?? '',
      enabled: true
    }
  })
  const disabled = current.filter((p) => !p.enabled)
  return [...fromUrl, ...disabled]
}

/** Таблица → URL: заменяет query-часть, сохраняя базу и #hash */
export function urlWithParams(url: string, params: KeyValue[]): string {
  const { base, hash } = splitUrl(url)
  const query = buildQuery(params)
  return `${base}${query ? `?${query}` : ''}${hash}`
}
