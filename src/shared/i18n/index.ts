import en from './en.json'
import ru from './ru.json'
import type { Language } from '../model'

export const resources = { ru, en } as const

type Tree = { [k: string]: string | Tree }

/** Простой резолвер `a.b.c` + интерполяция `{{name}}` — для main-процесса (меню, диалоги) */
export function translate(lang: Language, key: string, params?: Record<string, string | number>): string {
  const lookup = (l: Language): string | undefined => {
    let node: string | Tree | undefined = resources[l] as Tree
    for (const part of key.split('.')) {
      if (typeof node !== 'object' || node === null) return undefined
      node = node[part]
    }
    return typeof node === 'string' ? node : undefined
  }
  const text = lookup(lang) ?? lookup('en') ?? key
  return params ? text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, p: string) => String(params[p] ?? '')) : text
}
