import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { FullPageLoader } from '@/components/FullPageLoader'
import { DEFAULT_AUTHENTICATED_ROUTE } from './paths'

/** Keeps signed-in users out of the sign-in and sign-up screens. */
export function PublicRoute() {
  const { status } = useAuth()

  if (status === 'loading') {
    return <FullPageLoader label="Loading MARKA" />
  }

  if (status === 'authenticated') {
    return <Navigate to={DEFAULT_AUTHENTICATED_ROUTE} replace />
  }

  return <Outlet />
}
