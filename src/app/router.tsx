import { lazy, Suspense } from 'react'
import { createBrowserRouter, Navigate, type RouteObject } from 'react-router-dom'
import { AppShell } from '@/features/shell/AppShell'
import { FullPageLoader } from '@/components/FullPageLoader'
import { ProtectedRoute } from './routes/ProtectedRoute'
import { PublicRoute } from './routes/PublicRoute'
import { ROUTES } from './routes/paths'

/**
 * Route table.
 *
 * Everything except the auth screens is code-split: the workspace tabs are
 * placeholders today but will become the heaviest parts of the app, and
 * splitting now means adding a feature never regresses first paint.
 */
const SignInPage = lazy(() => import('@/features/auth/SignInPage'))
const SignUpPage = lazy(() => import('@/features/auth/SignUpPage'))
const OnboardingPage = lazy(() => import('@/features/onboarding/OnboardingPage'))
const ChatPage = lazy(() => import('@/features/chat/ChatPage'))
const OverviewPage = lazy(() => import('@/pages/OverviewPage'))
const CampaignsPage = lazy(() => import('@/pages/CampaignsPage'))
const CampaignDetailPage = lazy(() => import('@/pages/CampaignDetailPage'))
const CreativePage = lazy(() => import('@/pages/CreativePage'))
const AssetsPage = lazy(() => import('@/pages/AssetsPage'))
const LibraryPage = lazy(() => import('@/pages/LibraryPage'))
const CalendarPage = lazy(() => import('@/pages/CalendarPage'))
const ResultsPage = lazy(() => import('@/pages/ResultsPage'))
const BusinessPage = lazy(() => import('@/pages/BusinessPage'))
const SettingsPage = lazy(() => import('@/pages/SettingsPage'))
const NotFoundPage = lazy(() => import('@/pages/NotFoundPage'))

const withSuspense = (element: React.ReactNode) => (
  <Suspense fallback={<FullPageLoader />}>{element}</Suspense>
)

const routes: RouteObject[] = [
  {
    element: <PublicRoute />,
    children: [
      { path: ROUTES.signIn, element: withSuspense(<SignInPage />) },
      { path: ROUTES.signUp, element: withSuspense(<SignUpPage />) },
    ],
  },
  {
    element: <ProtectedRoute />,
    children: [
      // Onboarding is a full-page flow: no sidebar, no tabs, nothing to
      // wander off into before MARKA knows the business.
      { path: ROUTES.onboarding, element: withSuspense(<OnboardingPage />) },
      {
        element: <AppShell />,
        children: [
          { index: true, element: <Navigate to={ROUTES.chat} replace /> },
          { path: 'chat', element: withSuspense(<ChatPage />) },
          { path: 'chat/:conversationId', element: withSuspense(<ChatPage />) },
          { path: 'overview', element: withSuspense(<OverviewPage />) },
          { path: 'campaigns', element: withSuspense(<CampaignsPage />) },
          { path: 'campaigns/:campaignId', element: withSuspense(<CampaignDetailPage />) },
          { path: 'creative', element: withSuspense(<CreativePage />) },
          { path: 'assets', element: withSuspense(<AssetsPage />) },
          { path: 'library', element: withSuspense(<LibraryPage />) },
          { path: 'calendar', element: withSuspense(<CalendarPage />) },
          { path: 'results', element: withSuspense(<ResultsPage />) },
          { path: 'business', element: withSuspense(<BusinessPage />) },
          { path: 'settings', element: withSuspense(<SettingsPage />) },
        ],
      },
    ],
  },
  { path: '*', element: withSuspense(<NotFoundPage />) },
]

export const router = createBrowserRouter(routes)
