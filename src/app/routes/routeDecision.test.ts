import { describe, expect, it } from 'vitest'

import { decideProtectedRoute } from './routeDecision'

/**
 * The Phase 6H P0, pinned: a failed business load renders an error screen
 * with a retry — it must never fall through to the onboarding redirect,
 * where the natural next click creates a duplicate business.
 */

const base = {
  status: 'authenticated' as const,
  error: null,
  hasBusiness: true,
  onboardingComplete: true,
  onOnboardingRoute: false,
}

describe('decideProtectedRoute', () => {
  it('shows the app for a signed-in user with a loaded business', () => {
    expect(decideProtectedRoute(base)).toBe('app')
  })

  it('waits while auth is resolving — never a premature redirect', () => {
    expect(decideProtectedRoute({ ...base, status: 'loading', error: 'stale' })).toBe('loading')
  })

  it('sends a signed-out user to sign-in', () => {
    expect(decideProtectedRoute({ ...base, status: 'unauthenticated' })).toBe('signIn')
  })

  it('P0: a business-load failure is an error screen, NOT an onboarding redirect — even with an incomplete profile', () => {
    // The failure shape that motivated the fix: transient read failure, no
    // business in hand, profile unreadable too (onboarding not "complete").
    const decision = decideProtectedRoute({
      ...base,
      error: 'Could not load your business.',
      hasBusiness: false,
      onboardingComplete: false,
    })
    expect(decision).toBe('error')
  })

  it('a load error with no business blocks the app even for a completed profile', () => {
    const decision = decideProtectedRoute({
      ...base,
      error: 'Could not load your business.',
      hasBusiness: false,
      onboardingComplete: true,
    })
    expect(decision).toBe('error')
  })

  it('a stale error does not block the app once a business is loaded', () => {
    expect(decideProtectedRoute({ ...base, error: 'old news' })).toBe('app')
  })

  it('a genuinely business-less new user still lands in onboarding', () => {
    const decision = decideProtectedRoute({
      ...base,
      hasBusiness: false,
      onboardingComplete: false,
    })
    expect(decision).toBe('onboarding')
  })

  it('does not redirect when already on the onboarding route', () => {
    const decision = decideProtectedRoute({
      ...base,
      hasBusiness: false,
      onboardingComplete: false,
      onOnboardingRoute: true,
    })
    expect(decision).toBe('app')
  })

  it('a completed profile with no business is not forced into onboarding', () => {
    // Deleting your business intentionally should not trap you in the
    // onboarding wizard — the pre-fix behaviour, preserved.
    expect(decideProtectedRoute({ ...base, hasBusiness: false })).toBe('app')
  })
})
