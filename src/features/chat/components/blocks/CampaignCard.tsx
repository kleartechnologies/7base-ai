import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Megaphone } from 'lucide-react'
import { ROUTES } from '@/app/routes/paths'
import { generateCreativeMaterials } from '@/services/ai/ai.client'
import { Button } from '@/components/ui/button'
import type { CampaignCardBlock } from '@/types'

const CHANNEL_LABELS: Record<CampaignCardBlock['channels'][number], string> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  whatsapp: 'WhatsApp',
  tiktok: 'TikTok',
  in_store: 'In-store',
  website: 'Website',
}

/**
 * A campaign in the conversation: one calm, spacious card.
 *
 * Same design rule as the recommendation card — a marketing manager
 * summarising a decision, not a dashboard. Provenance tags keep "your
 * customers" and "my hypothesis about your customers" visually distinct.
 *
 * [Create Marketing Materials] hands the campaign to the creative engine.
 * The finished materials arrive as a new message in the thread, so this
 * button only needs to start the work and say that it is happening.
 */
export function CampaignCard({ block }: { block: CampaignCardBlock }) {
  const [creating, setCreating] = useState(false)
  const [materialsError, setMaterialsError] = useState<string | null>(null)

  const handleCreateMaterials = async () => {
    setCreating(true)
    setMaterialsError(null)
    const result = await generateCreativeMaterials({ campaignId: block.campaignId })
    setCreating(false)
    if (!result.ok) setMaterialsError(result.error.message)
    // On success the poster + captions arrive through the thread subscription.
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="border-b border-border px-5 py-3">
        <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
          <Megaphone className="size-3.5" aria-hidden />
          Campaign
          <span className="ml-auto rounded-full border border-border px-1.5 py-px text-[10px] font-normal normal-case tracking-normal text-muted-foreground">
            {block.status === 'draft' ? 'Draft' : block.status === 'ready' ? 'Ready' : 'Archived'}
          </span>
        </p>
        <h3 className="mt-1 text-[16px] font-semibold tracking-[-0.01em] text-foreground">
          {block.name}
        </h3>
      </div>

      <div className="space-y-4 px-5 py-4">
        {block.objective ? <Row label="Objective">{block.objective}</Row> : null}

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

        {block.keyMessage ? <Row label="Message">{block.keyMessage}</Row> : null}
        {block.callToAction ? <Row label="Call to action">{block.callToAction}</Row> : null}

        {block.channels.length > 0 ? (
          <Row label="Channels">
            {block.channels.map((channel) => CHANNEL_LABELS[channel]).join(' · ')}
          </Row>
        ) : null}

        {block.durationDays ? <Row label="Duration">{block.durationDays} days</Row> : null}
      </div>

      <div className="border-t border-border px-5 py-3.5">
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" asChild>
            <Link to={ROUTES.campaignDetail(block.campaignId)}>Edit</Link>
          </Button>
          <Button size="sm" onClick={handleCreateMaterials} disabled={creating}>
            {creating ? 'Creating your marketing materials…' : 'Create Marketing Materials'}
          </Button>
        </div>
        {creating ? (
          <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
            MARKA is writing your copy and preparing the poster. They’ll appear here as a new
            message — this can take a minute or two.
          </p>
        ) : null}
        {materialsError ? (
          <p className="mt-2 text-[13px] leading-relaxed text-destructive">{materialsError}</p>
        ) : null}
      </div>
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
