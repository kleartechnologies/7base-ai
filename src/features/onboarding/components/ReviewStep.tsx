import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { BusinessBrain } from '@/features/business/BusinessBrain'
import { latestDiscoverySource, missingQuestions } from '@/services/business/completion'
import type { Business } from '@/types'

/**
 * EVA does 90% of the work; the owner corrects the 10% that matters.
 *
 * No raw JSON, no confidence scores, no giant form — just what EVA
 * understood, in sections, each one editable in place. What she could not work
 * out is framed as the small remainder it is: a few things still missing, with
 * a way to fill them in, never a list of failures.
 */
export function ReviewStep({
  business,
  busy,
  error,
  onConfirm,
  onReanalyse,
}: {
  business: Business
  busy: boolean
  error?: string | null
  onConfirm: () => void
  onReanalyse: () => void
}) {
  // Whether "Looks good" leads into EVA's questions, so the missing-info box
  // can promise only what will actually happen next.
  const willAsk = missingQuestions(business).length > 0

  return (
    <div className="space-y-6">
      {business.discovery.summary ? (
        <div className="rounded-xl border border-border bg-secondary/40 px-5 py-4">
          <p className="text-[15px] leading-relaxed text-foreground">
            {business.discovery.summary}
          </p>
          <SourceNote business={business} />
        </div>
      ) : null}

      <BusinessBrain business={business} />

      {business.discovery.unknowns.length > 0 ? (
        <div className="rounded-xl border border-dashed border-border px-5 py-4">
          <p className="text-[13px] font-medium text-foreground">
            A few things are still missing
          </p>
          <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
            {sourceNoun(business)} didn’t say everything — that’s normal, not an error.
          </p>
          <ul className="mt-2 space-y-1 text-[13px] leading-relaxed text-muted-foreground">
            {business.discovery.unknowns.map((item) => (
              <li key={item}>• {item}</li>
            ))}
          </ul>
          <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">
            {willAsk
              ? 'After this, EVA will ask you a few quick questions and remember your answers. You can also fill anything in above — nothing is blocked.'
              : 'You can fill these in above, or tell EVA anytime from the Business tab — nothing is blocked.'}
          </p>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="text-[13px] leading-relaxed text-destructive">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 pt-2">
        <Button size="lg" disabled={busy} onClick={onConfirm}>
          {busy ? <Loader2 className="animate-spin" aria-hidden /> : null}
          Looks good — continue
        </Button>
        <Button size="lg" variant="ghost" disabled={busy} onClick={onReanalyse}>
          Try a different link
        </Button>
      </div>
    </div>
  )
}

/** Where this understanding came from, said separately from what it says. */
function SourceNote({ business }: { business: Business }) {
  const kind = latestDiscoverySource(business)
  if (!kind) return null
  const label =
    kind === 'facebook'
      ? 'From your Facebook Page'
      : kind === 'instagram'
        ? 'From your Instagram profile'
        : 'From your website'
  return <p className="mt-2 text-[12px] text-muted-foreground">{label}</p>
}

/** "Your Facebook Page" / "Your website" / "Your page", for running copy. */
function sourceNoun(business: Business): string {
  const kind = latestDiscoverySource(business)
  if (kind === 'facebook') return 'Your Facebook Page'
  if (kind === 'instagram') return 'Your Instagram profile'
  if (kind === 'website') return 'Your website'
  return 'Your page'
}
