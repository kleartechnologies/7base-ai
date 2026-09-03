import { createContext } from 'react'
import type { AuthUser } from '@/services/auth/auth.service'
import type { Business, UserProfile } from '@/types'

export interface AuthContextValue {
  status: 'loading' | 'authenticated' | 'unauthenticated'
  user: AuthUser | null
  profile: UserProfile | null
  /** The business the app is currently acting on. Null until onboarding. */
  business: Business | null
  error: string | null
  signOut: () => Promise<void>
  /** Re-reads profile and business after a mutation (e.g. onboarding). */
  refresh: () => Promise<void>
}

/**
 * Kept apart from `AuthProvider` so that file exports only a component — a
 * mixed module breaks Fast Refresh for the whole provider subtree.
 */
export const AuthContext = createContext<AuthContextValue | null>(null)
