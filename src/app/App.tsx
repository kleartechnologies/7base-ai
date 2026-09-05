import { RouterProvider } from 'react-router-dom'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AuthProvider } from './providers/AuthProvider'
import { LocaleProvider } from './providers/LocaleProvider'
import { ThemeProvider } from './providers/ThemeProvider'
import { ErrorBoundary } from './ErrorBoundary'
import { ConfigurationNotice } from './ConfigurationNotice'
import { getMissingEnvKeys } from '@/lib/env'
import { router } from './router'

export function App() {
  // Checked before anything touches Firebase, so a missing .env produces a
  // readable setup screen instead of an opaque SDK error.
  const missingEnv = getMissingEnvKeys()
  if (missingEnv.length > 0) {
    return <ConfigurationNotice missingKeys={missingEnv} />
  }

  return (
    <ErrorBoundary>
      <AuthProvider>
        <ThemeProvider>
          <LocaleProvider>
            <TooltipProvider delayDuration={300}>
              <RouterProvider router={router} />
            </TooltipProvider>
          </LocaleProvider>
        </ThemeProvider>
      </AuthProvider>
    </ErrorBoundary>
  )
}
