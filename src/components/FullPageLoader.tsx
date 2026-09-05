import { Loader2 } from 'lucide-react'
import { t } from '@/i18n/store'

/**
 * Uses the store `t`, not the context hook, so it can render above
 * LocaleProvider. Loaders are transient, so missing re-translation on a
 * language switch costs nothing.
 */
export function FullPageLoader({ label }: { label?: string }) {
  return (
    <div className="flex min-h-svh items-center justify-center bg-background">
      <div className="flex items-center gap-2.5 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden />
        <span>{label ?? t('common.loading')}…</span>
      </div>
    </div>
  )
}
