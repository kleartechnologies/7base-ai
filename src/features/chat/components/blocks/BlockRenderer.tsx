import { AlertCircle } from 'lucide-react'
import type { MessageBlock } from '@/types'
import { AttachmentBlockView } from './AttachmentBlockView'
import { CampaignCard } from './CampaignCard'
import { CreativePreview } from './CreativePreview'
import { RecommendationCard } from './RecommendationCard'

/**
 * Renders one structured block from an assistant message.
 *
 * This switch is the single extension point for MARKA's richer outputs. When
 * campaign cards and creative previews land, they add a `case` here — the
 * chat transport, storage and scroll behaviour stay untouched.
 *
 * Unknown block types render nothing rather than throwing, so a client running
 * older code never breaks on a message from a newer backend.
 */
export function BlockRenderer({
  block,
  conversationId,
}: {
  block: MessageBlock
  /** Present in the thread view; enables attachment actions like Save to Assets. */
  conversationId?: string
}) {
  switch (block.type) {
    case 'text':
      return (
        <p className="whitespace-pre-wrap text-[15px] leading-[1.65] text-foreground">
          {block.text}
        </p>
      )

    case 'error':
      return (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">
          <AlertCircle className="mt-px size-4 shrink-0" aria-hidden />
          <span>{block.message}</span>
        </div>
      )

    case 'marketing_recommendation':
      return <RecommendationCard block={block} />

    case 'campaign_card':
      return <CampaignCard block={block} />

    case 'creative_preview':
      return <CreativePreview block={block} />

    case 'attachment':
      return <AttachmentBlockView block={block} conversationId={conversationId} />

    // Declared in the type union, not yet rendered. Deliberately silent.
    case 'recommendation':
    case 'action':
      return null

    default:
      return null
  }
}
