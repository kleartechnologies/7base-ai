import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

/**
 * Last line of defence. Renders a plain recovery screen instead of a white
 * page, and keeps the raw error out of the UI so nothing internal leaks.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Replace with a real reporter (Sentry, Crashlytics) when one is chosen.
    console.error('Unhandled UI error', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <div className="flex min-h-svh flex-col items-center justify-center gap-5 px-6 text-center">
        <div className="space-y-2">
          <h1 className="text-[22px] font-semibold tracking-[-0.015em] text-foreground">
            Something went wrong
          </h1>
          <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">
            MARKA hit an unexpected problem. Reloading usually fixes it.
          </p>
        </div>
        <Button onClick={() => window.location.reload()}>Reload MARKA</Button>
      </div>
    )
  }
}
