/**
 * The routing decision behind ProtectedRoute, as a pure function.
 *
 * The order of these checks is the Phase 6H P0: a business-load failure must
 * surface as an explicit error screen, *before* the onboarding check gets a
 * chance to misread "the read failed" as "this account has no business" and
 * bounce a fully-onboarded user into onboarding — where the natural next
 * click would create a duplicate business.
 */

export type RouteDecision = 'loading' | 'signIn' | 'error' | 'onboarding' | 'app'

export function decideProtectedRoute(params: {
  status: 'loading' | 'authenticated' | 'unauthenticated'
  /** AuthProvider's load error — null when the last load succeeded. */
  error: string | null
  hasBusiness: boolean
  onboardingComplete: boolean
  /** Already on the onboarding route (no redirect needed to get there). */
  onOnboardingRoute: boolean
}): RouteDecision {
  if (params.status === 'loading') return 'loading'
  if (params.status === 'unauthenticated') return 'signIn'

  // A load failure with no business in hand is indistinguishable from "no
  // business exists" — so it must never fall through to the onboarding
  // redirect. With a business already loaded, the app is usable and the
  // stale error is not worth blocking it over.
  if (params.error && !params.hasBusiness) return 'error'

  const needsOnboarding = !params.hasBusiness && !params.onboardingComplete
  if (needsOnboarding && !params.onOnboardingRoute) return 'onboarding'

  return 'app'
}
