import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { resources } from '@shared/i18n'
import type { Language } from '@shared/model'

export async function initI18n(lng: Language): Promise<void> {
  await i18n.use(initReactI18next).init({
    resources: {
      ru: { translation: resources.ru },
      en: { translation: resources.en }
    },
    lng,
    fallbackLng: 'en',
    interpolation: { escapeValue: false }
  })
  document.documentElement.lang = lng
}

export async function changeLanguage(lng: Language): Promise<void> {
  await i18n.changeLanguage(lng)
  document.documentElement.lang = lng
}

export { i18n }
