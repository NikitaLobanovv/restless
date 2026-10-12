import type { KeyValue, RequestDraft } from './model'

/** `{{ name }}` — имя: всё, кроме фигурных скобок, без переносов строк */
export const VARIABLE_RE = /\{\{\s*([^{}\s][^{}\r\n]*?)\s*\}\}/g

const MAX_DEPTH = 10

/** Слои в порядке приоритета: первый выигрывает (окружение → коллекция → глобальные) */
export type VariableLayer = Record<string, string>

export interface ResolveResult {
  value: string
  unresolved: string[]
}

export function mergeLayers(layers: VariableLayer[]): VariableLayer {
  const merged: VariableLayer = {}
  for (let i = layers.length - 1; i >= 0; i--) Object.assign(merged, layers[i])
  return merged
}

export function findVariables(template: string): string[] {
  const names = new Set<string>()
  for (const m of template.matchAll(VARIABLE_RE)) names.add(m[1])
  return [...names]
}

/**
 * Подставляет переменные. Значения могут сами ссылаться на переменные —
 * они раскрываются рекурсивно до MAX_DEPTH (защита от циклов).
 */
export function resolveTemplate(template: string, vars: VariableLayer): ResolveResult {
  const unresolved = new Set<string>()
  const expand = (input: string, depth: number, stack: string[]): string =>
    input.replace(VARIABLE_RE, (whole, rawName: string) => {
      const key = rawName
      if (!Object.prototype.hasOwnProperty.call(vars, key)) {
        unresolved.add(key)
        return whole
      }
      if (depth >= MAX_DEPTH || stack.includes(key)) {
        unresolved.add(key)
        return whole
      }
      return expand(vars[key], depth + 1, [...stack, key])
    })
  const value = expand(template, 0, [])
  return { value, unresolved: [...unresolved] }
}

function resolveKv(list: KeyValue[], vars: VariableLayer, unresolved: Set<string>): KeyValue[] {
  return list.map((kv) => {
    if (!kv.enabled) return kv
    const k = resolveTemplate(kv.key, vars)
    const v = resolveTemplate(kv.value, vars)
    k.unresolved.forEach((u) => unresolved.add(u))
    v.unresolved.forEach((u) => unresolved.add(u))
    return { ...kv, key: k.value, value: v.value }
  })
}

/** Подставляет переменные во все части запроса: URL, параметры, заголовки, тело */
export function resolveDraft(draft: RequestDraft, vars: VariableLayer): { draft: RequestDraft; unresolved: string[] } {
  const unresolved = new Set<string>()
  const one = (s: string): string => {
    const r = resolveTemplate(s, vars)
    r.unresolved.forEach((u) => unresolved.add(u))
    return r.value
  }
  const resolved: RequestDraft = {
    ...draft,
    url: one(draft.url),
    params: resolveKv(draft.params, vars, unresolved),
    headers: resolveKv(draft.headers, vars, unresolved),
    body: {
      ...draft.body,
      raw:
        draft.body.type === 'json' || draft.body.type === 'text' || draft.body.type === 'xml'
          ? one(draft.body.raw)
          : draft.body.raw,
      urlencoded: resolveKv(draft.body.urlencoded, vars, unresolved),
      multipart: draft.body.multipart.map((f) =>
        f.enabled ? { ...f, key: one(f.key), value: f.kind === 'text' ? one(f.value) : f.value } : f
      )
    }
  }
  return { draft: resolved, unresolved: [...unresolved] }
}

/** Все имена переменных, на которые ссылается активная часть запроса */
export function referencedVariables(draft: RequestDraft): string[] {
  const parts: string[] = [draft.url]
  for (const kv of [...draft.params, ...draft.headers, ...draft.body.urlencoded]) {
    if (kv.enabled) parts.push(kv.key, kv.value)
  }
  if (['json', 'text', 'xml'].includes(draft.body.type)) parts.push(draft.body.raw)
  for (const f of draft.body.multipart) if (f.enabled) parts.push(f.key, f.value)
  return findVariables(parts.join('\n'))
}
