import { createContext } from 'react'
import type { AppearancePreference } from '@/lib/theme'

export interface ThemeContextValue {
  /** What the user chose: light, dark, or follow-the-system. */
  preference: AppearancePreference
  setPreference: (next: AppearancePreference) => void
}

/**
 * Kept apart from `ThemeProvider` so that file exports only a component — a
 * mixed module breaks Fast Refresh for the whole provider subtree.
 */
export const ThemeContext = createContext<ThemeContextValue | null>(null)
