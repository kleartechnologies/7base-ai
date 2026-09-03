import { Button } from '@/components/ui/button'
import type { DiscoveryErrorCode } from '@/types'
import type { AnalysisFailure } from '../useWebsiteAnalysis'

/**
 * What MARKA says when it cannot read a website.
 *
 * The messages are MARKA's own, in plain language. Nothing internal — no
 * status codes, no stack traces, no hostnames it refused to touch — reaches
 * this screen.
 *
 * The buttons matter as much as the sentence. Offering "try again" for a
 * failure that cannot clear on its own — an exhausted AI quota, a page with
 * nothing on it — sends the owner into a loop that wastes their time and
 * teaches them the product is broken. So the action offered is chosen from the
 * failure, not fixed.
 */

/** Failures where the same URL, tried again, could plausibly work. */
const RETRYABLE: readonly DiscoveryErrorCode[] = ['unreachable', 'ai_busy', 'ai_failed', 'internal']

/** Failures where typing it in themselves is the fastest way forward. */
const OFFER_MANUAL: readonly DiscoveryErrorCode[] = [
  'insufficient_content',
  'ai_unavailable',
  'ai_failed',
  'internal',
]

export function AnalysisFailed({
  failure,
  onRetryWebsite,
  onContinueManually,
}: {
  failure: AnalysisFailure
  onRetryWebsite: () => void
  onContinueManually: () => void
}) {
  const offerManual = OFFER_MANUAL.includes(failure.code)
  // When retrying cannot help, the manual path leads and the website button
  // becomes the quiet alternative rather than the obvious thing to press.
  const manualLeads = offerManual && !RETRYABLE.includes(failure.code)

  return (
    <div className="space-y-6">
      <p className="text-[15px] leading-relaxed text-foreground">{failure.message}</p>

      {failure.code === 'ai_unavailable' ? (
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          Nothing you did caused this, and trying again won’t clear it. You can still set MARKA up
          yourself in the meantime.
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button size="lg" variant={manualLeads ? 'outline' : 'default'} onClick={onRetryWebsite}>
          Try another website
        </Button>
        {offerManual ? (
          <Button
            size="lg"
            variant={manualLeads ? 'default' : 'ghost'}
            onClick={onContinueManually}
          >
            Continue manually
          </Button>
        ) : null}
      </div>
    </div>
  )
}
