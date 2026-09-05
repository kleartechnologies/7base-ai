import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useAuth } from '@/hooks/useAuth'
import {
  applyResolvedTheme,
  normaliseAppearance,
  readStoredAppearance,
  resolveTheme,
  storeAppearance,
  type AppearancePreference,
} from '@/lib/theme'
import { updateUserPreferences } from '@/services/business/user.service'
import { ThemeContext, type ThemeContextValue } from './theme-context'

/**
 * Owns the appearance preference: applies it to `<html>`, follows the OS while
 * it is 'system', and keeps localStorage and the profile in sync.
 *
 * localStorage is the fast copy (the index.html pre-paint script reads it
 * before React exists); the profile is the durable copy that follows the
 * account across sign-ins and devices. When a signed-in profile carries an
 * explicit appearance that differs from the local one, the profile wins.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const { user, profile } = useAuth()
  const userId = user?.uid ?? null
  const [preference, setPreferenceState] = useState<AppearancePreference>(readStoredAppearance)

  // Adopt the profile's saved appearance on sign-in, once per stored value —
  // the render-time adjust pattern, so there is no extra flash frame. Only an
  // explicit stored value counts: normalising an absent field would read as
  // "system" and wrongly override a local choice on legacy profiles.
  const storedAppearance = profile?.preferences?.appearance
  const [adoptedAppearance, setAdoptedAppearance] = useState<string | undefined>(undefined)
  if (typeof storedAppearance === 'string' && storedAppearance !== adoptedAppearance) {
    setAdoptedAppearance(storedAppearance)
    const fromProfile = normaliseAppearance(storedAppearance)
    if (fromProfile !== preference) setPreferenceState(fromProfile)
  }

  // Apply on every preference change, and track the OS while on 'system'.
  // Persisting here (not in setPreference) also covers profile adoption.
  useEffect(() => {
    storeAppearance(preference)
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      applyResolvedTheme(resolveTheme(preference, media.matches), document.documentElement)
    }
    apply()
    if (preference !== 'system') return
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [preference])

  const setPreference = useCallback(
    (next: AppearancePreference) => {
      setPreferenceState(next)
      if (userId) {
        // Fire-and-forget: the theme already changed locally; a failed profile
        // write only costs cross-device sync, which the next change retries.
        void updateUserPreferences(userId, { appearance: next }).catch(() => {})
      }
    },
    [userId],
  )

  const value = useMemo<ThemeContextValue>(
    () => ({ preference, setPreference }),
    [preference, setPreference],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}
