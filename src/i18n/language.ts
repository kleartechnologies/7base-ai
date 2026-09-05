/**
 * UI language preference: the logic half.
 *
 * Two static UI languages — English and Bahasa Melayu. Manglish is
 * deliberately NOT a third translation file: it is a conversational register
 * EVA mirrors in chat (see the backend prompt), not a way to label a button.
 *
 * Persistence mirrors the appearance preference exactly: localStorage for
 * instant, signed-out-safe reads; the user profile for logout/login and
 * cross-device continuity.
 */

export type Language = 'en' | 'ms'

/** Also hard-coded in index.html's pre-paint script — keep the two in sync. */
export const LANGUAGE_STORAGE_KEY = 'sevenbase.language'

export const DEFAULT_LANGUAGE: Language = 'en'

export const LANGUAGE_OPTIONS: readonly Language[] = ['en', 'ms']

/** Native-name labels are never translated — each language names itself. */
export const LANGUAGE_LABELS: Record<Language, string> = {
  en: 'English',
  ms: 'Bahasa Melayu',
}

/**
 * Values arrive from localStorage and Firestore profiles. Anything that is
 * not exactly a supported language falls back to English — including legacy
 * `locale` shapes like 'en-MY' that predate this preference.
 */
export function normaliseLanguage(value: unknown): Language {
  return value === 'ms' ? 'ms' : DEFAULT_LANGUAGE
}

export function readStoredLanguage(): Language {
  try {
    return normaliseLanguage(window.localStorage.getItem(LANGUAGE_STORAGE_KEY))
  } catch {
    return DEFAULT_LANGUAGE
  }
}

export function storeLanguage(language: Language): void {
  try {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language)
  } catch {
    // Losing persistence is acceptable; breaking the switch is not.
  }
}
