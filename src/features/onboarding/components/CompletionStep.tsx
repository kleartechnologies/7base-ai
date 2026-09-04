import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CompletionQuestions } from '@/features/business/components/CompletionQuestions'
import { observeBusiness } from '@/services/business/business.service'
import type { Business } from '@/types'

/**
 * The optional last step of onboarding: EVA asks for what discovery couldn't
 * find.
 *
 * Onboarding is already complete before this renders — the business exists,
 * the owner has accepted the review, and "Continue for now" is always one
 * click away. Nothing here can block anyone; it can only make EVA sharper.
 *
 * Answers are applied against the live document, not the copy the review
 * screen held: acceptance just rewrote provenance, and writing facts from a
 * stale snapshot would quietly undo those stamps.
 */
export function CompletionStep({
  businessId,
  onDone,
}: {
  businessId: string
  onDone: () => void
}) {
  const [live, setLive] = useState<Business | null>(null)
  const [finished, setFinished] = useState(false)

  useEffect(() => {
    return observeBusiness(businessId, (next) => {
      if (next) setLive(next)
    })
  }, [businessId])

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border bg-card px-6 py-5">
        {live ? (
          <CompletionQuestions business={live} onFinished={() => setFinished(true)} />
        ) : (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            One moment…
          </div>
        )}
      </div>

      {/* Always rendered, even while loading: this screen must never be able
          to trap anyone. Onboarding is already complete behind it. */}
      <Button size="lg" variant={finished ? 'default' : 'ghost'} onClick={onDone}>
        {finished ? 'Continue' : 'Continue for now'}
      </Button>
    </div>
  )
}
