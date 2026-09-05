import { cn } from '@/lib/utils'

/**
 * EVA's visual identity: a four-point spark, alone or in a bordered circle.
 *
 * The approved design gives the mark exactly three states — idle (static
 * violet), thinking (a 1.6s opacity pulse while EVA works), and muted (grey,
 * for interrupted or historical moments) — and one hard rule: the mark never
 * grows past 44px. The circle stays 26px everywhere except the empty-state
 * hero, which passes a larger className explicitly.
 */

export type EvaMarkState = 'idle' | 'thinking' | 'muted'

/** The bare spark glyph, coloured by `currentColor`. */
export function EvaSpark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
    >
      <path d="M12 3l1.9 6.1L20 11l-6.1 1.9L12 19l-1.9-6.1L4 11l6.1-1.9z" />
    </svg>
  )
}

/** The spark in its bordered circle — EVA's avatar beside her replies. */
export function EvaMark({
  state = 'idle',
  className,
  sparkClassName,
}: {
  state?: EvaMarkState
  className?: string
  sparkClassName?: string
}) {
  return (
    <span
      className={cn(
        'flex size-[26px] shrink-0 items-center justify-center rounded-full border border-border bg-card',
        className,
      )}
    >
      <EvaSpark
        className={cn(
          'size-[13px]',
          state === 'muted' ? 'text-muted-foreground' : 'text-eva',
          state === 'thinking' && 'animate-eva-pulse motion-reduce:animate-none',
          sparkClassName,
        )}
      />
    </span>
  )
}
