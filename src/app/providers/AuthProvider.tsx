import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { t } from '@/i18n/store'
import { observeAuth, signOutUser, type AuthUser } from '@/services/auth/auth.service'
import { getBusiness, getPrimaryBusiness } from '@/services/business/business.service'
import { getUserProfile } from '@/services/business/user.service'
import type { Business, UserProfile } from '@/types'
import { AuthContext, type AuthContextValue } from './auth-context'


/**
 * Owns the single source of truth for "who is signed in, and which business
 * are they working on". Everything downstream reads it through `useAuth`.
 *
 * Resolving the active business here — rather than in each page — means route
 * guards and the shell make one decision instead of five.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthContextValue['status']>('loading')
  const [user, setUser] = useState<AuthUser | null>(null)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [business, setBusiness] = useState<Business | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Guards against a slow business fetch resolving after sign-out.
  const activeUidRef = useRef<string | null>(null)

  const loadBusiness = useCallback(async (nextProfile: UserProfile | null, uid: string) => {
    try {
      // Resolve strictly through the profile's own index: the explicitly
      // selected business first, then anything else the profile lists. A
      // provisional business document created for a website analysis is only
      // linked into that index once the analysis succeeds, so querying by
      // `ownerId` here would resurrect half-analysed leftovers and let a
      // not-yet-onboarded user through the onboarding guard. The `ownerId`
      // query survives only as a last resort for a profile that failed to
      // load at all.
      let resolved: Business | null = null
      if (nextProfile) {
        const candidates = [nextProfile.activeBusinessId, ...nextProfile.businessIds].filter(
          (id, index, all): id is string => Boolean(id) && all.indexOf(id) === index,
        )
        for (const id of candidates) {
          resolved = await getBusiness(id)
          if (resolved) break
        }
      } else {
        resolved = await getPrimaryBusiness(uid)
      }

      if (activeUidRef.current === uid) {
        setBusiness(resolved)
        setError(null)
      }
    } catch {
      // This branch is a *failed load*, not the normal pre-onboarding state —
      // a user with no business resolves to null above without throwing. Say
      // so instead of silently pretending the business does not exist.
      if (activeUidRef.current === uid) {
        setBusiness(null)
        setError(t('app.businessLoadFailed'))
      }
    }
  }, [])

  useEffect(() => {
    const unsubscribe = observeAuth(
      (nextUser, nextProfile) => {
        activeUidRef.current = nextUser?.uid ?? null
        setUser(nextUser)
        setProfile(nextProfile)
        setStatus(nextUser ? 'authenticated' : 'unauthenticated')

        if (!nextUser) {
          setBusiness(null)
          return
        }
        void loadBusiness(nextProfile, nextUser.uid)
      },
      (nextError) => {
        setError(nextError instanceof Error ? nextError.message : t('app.authFailed'))
      },
    )
    return unsubscribe
  }, [loadBusiness])

  const refresh = useCallback(async () => {
    const uid = activeUidRef.current
    if (!uid) return
    const nextProfile = await getUserProfile(uid)
    setProfile(nextProfile)
    await loadBusiness(nextProfile, uid)
  }, [loadBusiness])

  const handleSignOut = useCallback(async () => {
    await signOutUser()
    activeUidRef.current = null
    setBusiness(null)
    setProfile(null)
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({ status, user, profile, business, error, signOut: handleSignOut, refresh }),
    [status, user, profile, business, error, handleSignOut, refresh],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
