import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './locales/en.json'

export const LANGUAGES = [
  { code: 'en', label: 'English', dir: 'ltr' },
  { code: 'fr', label: 'Français', dir: 'ltr' },
] as const

export type LanguageCode = (typeof LANGUAGES)[number]['code']

const STORAGE_KEY = 'agh.lang'

// English ships in the main bundle; every other language is fetched only when chosen.
const loaders: Record<Exclude<LanguageCode, 'en'>, () => Promise<{ default: object }>> = {
  fr: () => import('./locales/fr.json'),
}

function isSupported(code: string | null | undefined): code is LanguageCode {
  return LANGUAGES.some((l) => l.code === code)
}

function detectLanguage(): LanguageCode {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (isSupported(stored)) return stored
  } catch {
    // Storage can be blocked (private mode); fall through to the browser language.
  }
  const browser = typeof navigator === 'undefined' ? undefined : navigator.language?.slice(0, 2).toLowerCase()
  return isSupported(browser) ? browser : 'en'
}

function applyDocumentLanguage(code: string) {
  if (typeof document === 'undefined') return
  document.documentElement.lang = code
  document.documentElement.dir = LANGUAGES.find((l) => l.code === code)?.dir ?? 'ltr'
}

export async function setLanguage(code: LanguageCode) {
  if (code !== 'en' && !i18n.hasResourceBundle(code, 'translation')) {
    const bundle = await loaders[code]()
    i18n.addResourceBundle(code, 'translation', bundle.default)
  }
  await i18n.changeLanguage(code)
  try {
    localStorage.setItem(STORAGE_KEY, code)
  } catch {
    // Not persisted; the choice still applies for this visit.
  }
}

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en } },
  lng: 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
})

i18n.on('languageChanged', applyDocumentLanguage)
applyDocumentLanguage('en')

let detectedApplied = false

/**
 * Switches to the visitor's language (saved choice, else browser language). Called once at
 * start-up. On the prerendered landing page it is called only after React has attached to the
 * English HTML, because switching earlier would make the page disagree with that HTML.
 */
export function applyDetectedLanguage() {
  if (detectedApplied) return
  detectedApplied = true
  const initial = detectLanguage()
  if (initial === 'en') return
  setLanguage(initial).catch(() => {
    // Offline or chunk failed: stay in English rather than block the app.
  })
}

export default i18n
