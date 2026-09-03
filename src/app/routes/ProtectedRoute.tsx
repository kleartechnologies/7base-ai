import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { FullPageLoader } from '@/components/FullPageLoader'
import { ROUTES } from './paths'

/**
 * Gate for everything behind sign-in.
 *
 * The loading state matters: rendering `<Navigate>` while auth is still
 * resolving would bounce an already-signed-in user to the sign-in page on
 * every refresh.
 */
export function ProtectedRoute() {
  const { status, profile, business } = useAuth()
  const location = useLocation()

  if (status === 'loading') {
    return <FullPageLoader label="Loading MARKA" />
  }

  if (status === 'unauthenticated') {
    // Remember where they were headed so sign-in can return them there.
    return <Navigate to={ROUTES.signIn} replace state={{ from: location.pathname }} />
  }

  // A signed-in user with no business has nothing useful to look at yet:
  // every tab would be empty and the chat would know nothing about them.
  // This deliberately does not require a loaded profile — a user with neither
  // a profile nor a business belongs in onboarding, not on an empty /chat or
  // whatever deep link they arrived on.
  const needsOnboarding = !business && profile?.onboarding.step !== 'complete'

  if (needsOnboarding && location.pathname !== ROUTES.onboarding) {
    return <Navigate to={ROUTES.onboarding} replace />
  }

  return <Outlet />
}
