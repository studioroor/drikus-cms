import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { en } from '@/locales/en'
import { nl } from '@/locales/nl'

export type Locale = 'nl' | 'en'
const STORAGE_KEY = 'drikus.locale'

function initialLocale(): Locale {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'nl' || stored === 'en') return stored
  } catch {}
  return navigator.language.toLowerCase().startsWith('en') ? 'en' : 'nl'
}

i18n.use(initReactI18next).init({
  resources: { nl: { translation: nl }, en: { translation: en } },
  lng: initialLocale(),
  fallbackLng: 'nl',
  interpolation: { escapeValue: false },
})

export function setLocale(locale: Locale) {
  try {
    localStorage.setItem(STORAGE_KEY, locale)
  } catch {}
  document.documentElement.lang = locale
  if (i18n.language !== locale) i18n.changeLanguage(locale)
}

declare module 'i18next' {
  interface CustomTypeOptions {
    resources: { translation: typeof nl }
  }
}

export default i18n
