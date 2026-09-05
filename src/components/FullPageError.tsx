import { useState } from 'react'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * Full-page failure state for errors that block the whole app shell —
 * currently the AuthProvider's business-load failure. Pairs an honest
 * sentence with the one action that can fix it.
 */
export function FullPageError({
  message,
  onRetry,
}: {
  message: string
  onRetry: () => Promise<void>
}) {
  const [retrying, setRetrying] = useState(false)

  const retry = () => {
    setRetrying(true)
    onRetry()
      .catch(() => {
        // The provider surfaces the failure through its own error state;
        // this screen just needs its button back.
      })
      .finally(() => setRetrying(false))
  }

  return (
    <div className="flex min-h-svh items-center justify-center bg-background">
      <div className="flex max-w-sm flex-col items-center gap-4 px-6 text-center">
        <AlertTriangle className="size-8 text-muted-foreground" aria-hidden />
        <p className="text-sm text-muted-foreground">{message}</p>
        <Button onClick={retry} disabled={retrying}>
          {retrying ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Retrying…
            </>
          ) : (
            'Try again'
          )}
        </Button>
      </div>
    </div>
  )
}
