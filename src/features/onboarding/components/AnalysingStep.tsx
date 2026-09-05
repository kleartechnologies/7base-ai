import { Check, Loader2 } from 'lucide-react'
import { useI18n } from '@/hooks/useI18n'
import type { MessageKey } from '@/i18n/translate'
import type { DiscoveryStage } from '@/types'

/**
 * Real progress, not a fake bar.
 *
 * Each line is a stage the backend actually writes to the business document as
 * it reaches it. If a stage is slow, the screen honestly sits on it rather
 * than inventing a percentage.
 */
const STAGES: { id: DiscoveryStage; labelKey: MessageKey }[] = [
  { id: 'fetching', labelKey: 'onboarding.stageFetching' },
  { id: 'reading_pages', labelKey: 'onboarding.stageReadingPages' },
  { id: 'understanding', labelKey: 'onboarding.stageUnderstanding' },
  { id: 'building_brain', labelKey: 'onboarding.stageBuildingBrain' },
  { id: 'saving', labelKey: 'onboarding.stageSaving' },
]

export function AnalysingStep({ stage }: { stage: DiscoveryStage | null }) {
  const { t } = useI18n()
  // Before the first stage is written, the first step is the one in progress.
  const currentIndex = Math.max(
    0,
    STAGES.findIndex((item) => item.id === stage),
  )

  return (
    <ol className="space-y-3">
      {STAGES.map((item, index) => {
        const done = index < currentIndex
        const active = index === currentIndex
        return (
          <li
            key={item.id}
            className={`flex items-center gap-3 text-[15px] ${
              done ? 'text-muted-foreground' : active ? 'text-foreground' : 'text-muted-foreground/45'
            }`}
          >
            <span className="flex size-5 shrink-0 items-center justify-center">
              {done ? (
                <Check className="size-4" aria-hidden />
              ) : active ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <span className="size-1.5 rounded-full bg-current" aria-hidden />
              )}
            </span>
            {t(item.labelKey)}
          </li>
        )
      })}
    </ol>
  )
}
