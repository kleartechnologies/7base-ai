import { memo } from 'react'
import { AlertCircle } from 'lucide-react'
import type { MessageBlock } from '@/types'
import { Markdown } from '../Markdown'
import { ActionProposalCard } from './ActionProposalCard'
import { AttachmentBlockView } from './AttachmentBlockView'
import { CampaignCard } from './CampaignCard'
import { CreativePreview } from './CreativePreview'
import { CreativeSetCard } from './CreativeSetCard'
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
 *
 * Memoised alongside MessageBubble: stored blocks never mutate, so a settled
 * block never needs to re-render during streaming flushes.
 */
export const BlockRenderer = memo(function BlockRenderer({
  block,
  conversationId,
  markdown = false,
  isLatest = false,
}: {
  block: MessageBlock
  /** Present in the thread view; enables attachment actions like Save to Assets. */
  conversationId?: string
  /**
   * Render text as Markdown. On for EVA's turns — she writes `**bold**` and
   * numbered lists — and off for the owner's, whose words show exactly as
   * typed.
   */
  markdown?: boolean
  /** True for the newest turn in the thread; only it shows go-ahead buttons. */
  isLatest?: boolean
}) {
  switch (block.type) {
    case 'text':
      return markdown ? <Markdown text={block.text} /> : (
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

    case 'action_proposal':
      return <ActionProposalCard block={block} isLatest={isLatest} />

    case 'creative_set':
      return <CreativeSetCard block={block} />

    // Declared in the type union, not yet rendered. Deliberately silent.
    case 'recommendation':
    case 'action':
      return null

    default:
      return null
  }
})
