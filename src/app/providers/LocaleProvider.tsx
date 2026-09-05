import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import { useAuth } from '@/hooks/useAuth'
import { normaliseLanguage, readStoredLanguage, storeLanguage, type Language } from '@/i18n/language'
import { getLanguage, setLanguageValue, subscribeLanguage } from '@/i18n/store'
import { translate, type MessageKey, type TranslateParams } from '@/i18n/translate'
import { updateUserPreferences } from '@/services/business/user.service'
import { LocaleContext, type LocaleContextValue } from './locale-context'

// Seed the module store from localStorage before anything renders, so the
// first paint and non-React callers (error mappers, services) already speak
// the remembered language. Module scope, not an effect: effects run after the
// first render, which would flash English.
setLanguageValue(readStoredLanguage())

/**
 * Owns the UI language: exposes `t`, keeps `<html lang>` accurate, and keeps
 * localStorage and the profile in sync.
 *
 * The value itself lives in the i18n module store (src/i18n/store.ts) so code
 * outside the React tree translates consistently; this provider is the React
 * view onto that store plus the persistence glue. When a signed-in profile
 * carries an explicit language that differs from the local one, the profile
 * wins.
 */
export function LocaleProvider({ children }: { children: ReactNode }) {
  const { user, profile } = useAuth()
  const userId = user?.uid ?? null
  const language = useSyncExternalStore(subscribeLanguage, getLanguage)

  // Adopt the profile's saved language on sign-in, once per stored value.
  // Only an explicit stored value counts — an absent field must not reset a
  // local choice to English. The store setter is an external-store write, not
  // React state, so render is the wrong place for it; an effect is right.
  const storedLanguage = profile?.preferences?.language
  const [adoptedLanguage, setAdoptedLanguage] = useState<string | undefined>(undefined)
  const shouldAdopt = typeof storedLanguage === 'string' && storedLanguage !== adoptedLanguage
  if (shouldAdopt) setAdoptedLanguage(storedLanguage)
  useEffect(() => {
    if (shouldAdopt) setLanguageValue(normaliseLanguage(storedLanguage))
  }, [shouldAdopt, storedLanguage])

  // Persist and mirror every language change, wherever it came from.
  useEffect(() => {
    storeLanguage(language)
    document.documentElement.lang = language
  }, [language])

  const setLanguage = useCallback(
    (next: Language) => {
      setLanguageValue(next)
      if (userId) {
        // Fire-and-forget: the UI already switched; a failed profile write
        // only costs cross-device sync, which the next change retries.
        void updateUserPreferences(userId, { language: next }).catch(() => {})
      }
    },
    [userId],
  )

  const value = useMemo<LocaleContextValue>(
    () => ({
      language,
      setLanguage,
      t: (key: MessageKey, params?: TranslateParams) => translate(language, key, params),
    }),
    [language, setLanguage],
  )

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
}
