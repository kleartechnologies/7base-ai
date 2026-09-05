import type { LucideIcon } from 'lucide-react'
import { useI18n } from '@/hooks/useI18n'

interface PlaceholderPageProps {
  title: string
  description: string
  icon: LucideIcon
  /** What the user should do until this tab exists. */
  hint?: string
}

/**
 * The shared shape for workspace tabs that have architecture but no feature
 * yet. It states plainly that the tab is empty and points back to the chat,
 * rather than faking charts and cards.
 */
export function PlaceholderPage({ title, description, icon: Icon, hint }: PlaceholderPageProps) {
  const { t } = useI18n()
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-8 py-12">
        <header className="mb-10">
          <h1 className="text-[22px] font-semibold tracking-[-0.015em] text-foreground">{title}</h1>
          <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">{description}</p>
        </header>

        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border px-6 py-16 text-center">
          <Icon className="size-6 text-muted-foreground/60" aria-hidden />
          <p className="mt-4 text-sm font-medium text-foreground">{t('app.nothingHereYet')}</p>
          {hint ? (
            <p className="mt-1.5 max-w-sm text-[13px] leading-relaxed text-muted-foreground">
              {hint}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  )
}
