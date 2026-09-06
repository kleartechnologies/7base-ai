import type { ReactNode } from 'react'
import { EvaMark, EvaSpark, type EvaMarkState } from '@/components/EvaMark'

/**
 * The frame around every EVA reply: her mark beside the prose on desktop,
 * a small "EVA" caps label with the spark above it on mobile. Shared by
 * settled messages and the live streaming reply so the two never drift.
 */
export function EvaTurn({
  children,
  markState = 'idle',
}: {
  children: ReactNode
  /** `thinking` while EVA is still working on what this turn will show. */
  markState?: EvaMarkState
}) {
  return (
    <div className="flex w-full gap-3">
      <EvaMark state={markState} className="mt-0.5 hidden sm:flex" />
      <div className="min-w-0 flex-1 space-y-3">
        <EvaLabel />
        {children}
      </div>
    </div>
  )
}

/** The mobile-only "EVA" label. Not translated: EVA is a proper noun. */
export function EvaLabel() {
  return (
    <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground sm:hidden">
      <EvaSpark className="size-3 text-eva" />
      EVA
    </p>
  )
}
