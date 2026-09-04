import { useState } from 'react'
import { Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { buildCampaignFromRecommendation } from '@/services/ai/ai.client'
import type { MarketingRecommendationBlock } from '@/types'

/**
 * MARKA's recommendation, rendered as one calm card in the conversation.
 *
 * The design rule: this is a marketing manager summarising a decision, not a
 * dashboard. Facts, hypotheses and recommendations are visually distinguished
 * by small provenance tags, because "your customers" and "my guess about your
 * customers" must never look the same.
 *
 * [Build this campaign] asks the backend to turn this recommendation into a
 * campaign draft. The confirmation message — with its campaign card — arrives
 * through the same Firestore subscription as every other assistant turn, so
 * there is nothing to render optimistically here.
 */
export function RecommendationCard({ block }: { block: MarketingRecommendationBlock }) {
  const [building, setBuilding] = useState(false)
  const [built, setBuilt] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleBuild() {
    setBuilding(true)
    setError(null)
    const result = await buildCampaignFromRecommendation({
      recommendationId: block.recommendationId,
    })
    setBuilding(false)
    if (result.ok) {
      setBuilt(true)
    } else {
      setError(result.error.message)
    }
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="border-b border-border px-5 py-3">
        <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
          <Sparkles className="size-3.5" aria-hidden />
          EVA’s recommendation
        </p>
        <h3 className="mt-1 text-[16px] font-semibold tracking-[-0.01em] text-foreground">
          {block.title}
        </h3>
      </div>

      <div className="space-y-4 px-5 py-4">
        <Row label="Goal">{block.goal}</Row>
        <Row label="Diagnosis">{block.diagnosis}</Row>
        <Row label="Why">{block.why}</Row>

        {block.audience ? (
          <Row label="Audience" tag={block.audience.basis === 'known' ? 'Known' : 'Hypothesis'}>
            {block.audience.description}
          </Row>
        ) : null}

        {block.offer ? (
          <Row
            label="Offer"
            tag={block.offer.basis === 'existing' ? 'Existing' : 'Recommendation'}
          >
            {block.offer.description}
          </Row>
        ) : null}

        <Row label="Confidence">
          <span className="capitalize">{block.confidence}</span>
        </Row>
      </div>

      {block.nextAction === 'build_campaign' ? (
        <div className="border-t border-border px-5 py-3.5">
          <Button size="sm" onClick={() => void handleBuild()} disabled={building || built}>
            {building ? 'Building…' : built ? 'Campaign created' : 'Build this campaign'}
          </Button>
          {error ? (
            <p role="alert" className="mt-2 text-[13px] text-destructive">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function Row({
  label,
  tag,
  children,
}: {
  label: string
  tag?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <p className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
        {label}
        {tag ? (
          <span className="rounded-full border border-border px-1.5 py-px text-[10px] font-normal normal-case tracking-normal text-muted-foreground">
            {tag}
          </span>
        ) : null}
      </p>
      <p className="mt-1 text-[14px] leading-relaxed text-foreground">{children}</p>
    </div>
  )
}
