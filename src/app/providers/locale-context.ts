import { createContext } from 'react'
import type { Language } from '@/i18n/language'
import type { MessageKey, TranslateParams } from '@/i18n/translate'

export interface LocaleContextValue {
  language: Language
  setLanguage: (next: Language) => void
  /** Translate in the active language. Re-renders subscribers on change. */
  t: (key: MessageKey, params?: TranslateParams) => string
}

/**
 * Kept apart from `LocaleProvider` so that file exports only a component — a
 * mixed module breaks Fast Refresh for the whole provider subtree.
 */
export const LocaleContext = createContext<LocaleContextValue | null>(null)
