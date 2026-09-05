import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { useI18n } from '@/hooks/useI18n'
import { FullPageError } from '@/components/FullPageError'
import { FullPageLoader } from '@/components/FullPageLoader'
import { decideProtectedRoute } from './routeDecision'
import { ROUTES } from './paths'

/**
 * Gate for everything behind sign-in.
 *
 * The loading state matters: rendering `<Navigate>` while auth is still
 * resolving would bounce an already-signed-in user to the sign-in page on
 * every refresh. The error state matters just as much: a failed business
 * load must say so and offer a retry — never masquerade as "no business"
 * and dump an onboarded user back into onboarding (see routeDecision.ts).
 */
export function ProtectedRoute() {
  const { status, profile, business, error, refresh } = useAuth()
  const { t } = useI18n()
  const location = useLocation()

  const decision = decideProtectedRoute({
    status,
    error,
    hasBusiness: business !== null,
    // A signed-in user with no business has nothing useful to look at yet:
    // every tab would be empty and the chat would know nothing about them.
    // This deliberately does not require a loaded profile — a user with
    // neither a profile nor a business belongs in onboarding, not on an
    // empty /chat or whatever deep link they arrived on.
    onboardingComplete: profile?.onboarding.step === 'complete',
    onOnboardingRoute: location.pathname === ROUTES.onboarding,
  })

  switch (decision) {
    case 'loading':
      return <FullPageLoader label={t('app.loading')} />
    case 'signIn':
      // Remember where they were headed so sign-in can return them there.
      return <Navigate to={ROUTES.signIn} replace state={{ from: location.pathname }} />
    case 'error':
      return <FullPageError message={error ?? t('firebaseError.fallback')} onRetry={refresh} />
    case 'onboarding':
      return <Navigate to={ROUTES.onboarding} replace />
    case 'app':
      return <Outlet />
  }
}
