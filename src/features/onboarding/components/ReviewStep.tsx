import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { BusinessBrain } from '@/features/business/BusinessBrain'
import type { Business } from '@/types'

/**
 * MARKA does 90% of the work; the owner corrects the 10% that matters.
 *
 * No raw JSON, no confidence scores, no giant form — just what MARKA
 * understood, in sections, each one editable in place. What it could not work
 * out is stated plainly rather than papered over with a guess.
 */
export function ReviewStep({
  business,
  busy,
  onConfirm,
  onReanalyse,
}: {
  business: Business
  busy: boolean
  onConfirm: () => void
  onReanalyse: () => void
}) {
  return (
    <div className="space-y-6">
      {business.discovery.summary ? (
        <p className="rounded-xl border border-border bg-secondary/40 px-5 py-4 text-[15px] leading-relaxed text-foreground">
          {business.discovery.summary}
        </p>
      ) : null}

      <BusinessBrain business={business} />

      {business.discovery.unknowns.length > 0 ? (
        <div className="rounded-xl border border-dashed border-border px-5 py-4">
          <p className="text-[13px] font-medium text-foreground">MARKA couldn’t work these out</p>
          <ul className="mt-2 space-y-1 text-[13px] leading-relaxed text-muted-foreground">
            {business.discovery.unknowns.map((item) => (
              <li key={item}>• {item}</li>
            ))}
          </ul>
          <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">
            You can tell MARKA in chat, or fill them in above — nothing is blocked.
          </p>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 pt-2">
        <Button size="lg" disabled={busy} onClick={onConfirm}>
          {busy ? <Loader2 className="animate-spin" aria-hidden /> : null}
          Looks good — continue
        </Button>
        <Button size="lg" variant="ghost" disabled={busy} onClick={onReanalyse}>
          Analyse a different website
        </Button>
      </div>
    </div>
  )
}
