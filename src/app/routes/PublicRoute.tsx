import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { useI18n } from '@/hooks/useI18n'
import { FullPageLoader } from '@/components/FullPageLoader'
import { DEFAULT_AUTHENTICATED_ROUTE } from './paths'

/** Keeps signed-in users out of the sign-in and sign-up screens. */
export function PublicRoute() {
  const { status } = useAuth()
  const { t } = useI18n()

  if (status === 'loading') {
    return <FullPageLoader label={t('app.loading')} />
  }

  if (status === 'authenticated') {
    return <Navigate to={DEFAULT_AUTHENTICATED_ROUTE} replace />
  }

  return <Outlet />
}
