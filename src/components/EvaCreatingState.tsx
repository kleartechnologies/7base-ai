import { useI18n } from '@/hooks/useI18n'
import { cn } from '@/lib/utils'
import { EvaMark } from '@/components/EvaMark'
import type { MessageKey } from '@/i18n/messages/en'

/**
 * EVA while she is making something.
 *
 * The state a generic spinner used to occupy. Her mark sits inside a slow
 * orbit and a faint halo — enough to read as somebody working, not enough to
 * watch — beside a line saying what is being made and one muted line naming
 * the work itself: the copy, the visual, the poster. Those three are what the
 * generation call actually does, in that order, every time.
 *
 * What it deliberately never shows is a percentage, a countdown or a step
 * lighting up on a timer. The button path is one callable that returns when
 * it is done; it reports nothing in between, so any progress shown here would
 * be invented. (Chat is different — the backend streams real steps there, and
 * `ActionProgress` renders those.) The honest thing to say is what EVA is
 * doing and roughly how long it takes.
 *
 * Reusable: anything with a wait of this shape passes its own title.
 */
export function EvaCreatingState({
  title = 'creative.evaCreatingTitle',
  detail = 'creative.evaCreatingDetail',
  note = 'creative.evaCreatingNote',
  className,
}: {
  title?: MessageKey
  detail?: MessageKey
  /** Set null to drop the "takes a minute" line where it would be noise. */
  note?: MessageKey | null
  className?: string
}) {
  const { t } = useI18n()

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'flex min-h-[84px] items-center gap-4 rounded-xl border border-eva-tint-border bg-eva-tint px-4 py-4',
        className,
      )}
    >
      <EvaCreatingMark />
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-medium leading-snug text-foreground">{t(title)}</p>
        <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{t(detail)}</p>
        {note ? (
          <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{t(note)}</p>
        ) : null}
      </div>
    </div>
  )
}

/**
 * The mark, orbited. 44px overall — the ceiling the identity sets for it —
 * with the 26px mark unchanged at the centre, so this reads as the same EVA
 * everywhere else in the product rather than a second, bigger one.
 */
export function EvaCreatingMark({ className }: { className?: string }) {
  return (
    <span className={cn('relative flex size-11 shrink-0 items-center justify-center', className)}>
      <span
        className="absolute inset-0 rounded-full bg-eva/12 animate-eva-halo motion-reduce:animate-none"
        aria-hidden
      />
      <span
        className="absolute inset-0 animate-eva-orbit motion-reduce:animate-none"
        aria-hidden
      >
        <span className="absolute left-1/2 top-0 size-1.5 -translate-x-1/2 rounded-full bg-eva" />
      </span>
      <EvaMark state="thinking" className="relative" />
    </span>
  )
}
