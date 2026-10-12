import { resources, translate } from '../shared/i18n'
import type { Language } from '../shared/model'

let lang: Language = 'ru'

export function setLanguage(next: Language): void {
  if (next in resources) lang = next
}

export function getLanguage(): Language {
  return lang
}

export function t(key: string, params?: Record<string, string | number>): string {
  return translate(lang, key, params)
}
