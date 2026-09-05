import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Megaphone } from 'lucide-react'
import { ROUTES } from '@/app/routes/paths'
import { generateCreativeMaterials } from '@/services/ai/ai.client'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/hooks/useI18n'
import type { CampaignCardBlock } from '@/types'

// Channel proper nouns read the same in every language; only the two
// non-brand channels (in-store, website) go through the dictionary.
const CHANNEL_PROPER_NOUNS: Partial<Record<CampaignCardBlock['channels'][number], string>> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  whatsapp: 'WhatsApp',
  tiktok: 'TikTok',
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
  const { t } = useI18n()
  const [creating, setCreating] = useState(false)
  const [materialsError, setMaterialsError] = useState<string | null>(null)

  const channelLabel = (channel: CampaignCardBlock['channels'][number]) =>
    channel === 'in_store'
      ? t('campaign.channelInStore')
      : channel === 'website'
        ? t('campaign.channelWebsite')
        : (CHANNEL_PROPER_NOUNS[channel] ?? channel)

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
          {t('campaign.title')}
          <span className="ml-auto rounded-full border border-border px-1.5 py-px text-[10px] font-normal normal-case tracking-normal text-muted-foreground">
            {block.status === 'draft'
              ? t('campaign.statusDraft')
              : block.status === 'ready'
                ? t('campaign.statusReady')
                : t('campaign.statusArchived')}
          </span>
        </p>
        <h3 className="mt-1 text-[16px] font-semibold tracking-[-0.01em] text-foreground">
          {block.name}
        </h3>
      </div>

      <div className="space-y-4 px-5 py-4">
        {block.objective ? <Row label={t('campaign.objective')}>{block.objective}</Row> : null}

        {block.audience ? (
          <Row
            label={t('campaign.audience')}
            tag={block.audience.basis === 'known' ? t('campaign.tagKnown') : t('campaign.tagHypothesis')}
          >
            {block.audience.description}
          </Row>
        ) : null}

        {block.offer ? (
          <Row
            label={t('campaign.offer')}
            tag={
              block.offer.basis === 'existing'
                ? t('campaign.tagExisting')
                : t('campaign.tagRecommendation')
            }
          >
            {block.offer.description}
          </Row>
        ) : null}

        {block.keyMessage ? <Row label={t('campaign.message')}>{block.keyMessage}</Row> : null}
        {block.callToAction ? (
          <Row label={t('campaign.callToAction')}>{block.callToAction}</Row>
        ) : null}

        {block.channels.length > 0 ? (
          <Row label={t('campaign.channels')}>
            {block.channels.map(channelLabel).join(' · ')}
          </Row>
        ) : null}

        {block.durationDays ? (
          <Row label={t('campaign.duration')}>
            {t('campaign.durationDays', { days: block.durationDays })}
          </Row>
        ) : null}
      </div>

      <div className="border-t border-border px-5 py-3.5">
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" asChild>
            <Link to={ROUTES.campaignDetail(block.campaignId)}>{t('common.edit')}</Link>
          </Button>
          <Button size="sm" onClick={handleCreateMaterials} disabled={creating}>
            {creating ? t('campaign.creatingMaterials') : t('campaign.createMaterials')}
          </Button>
        </div>
        {creating ? (
          <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
            {t('campaign.creatingMaterialsNote')}
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
