import { ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/hooks/useI18n'
import type { ActionProposalBlock } from '@/types'
import { useChatActions } from '../../chatActionsContext'

/**
 * The go-ahead for something EVA offered: one button, or one per campaign
 * when she needs the owner to pick.
 *
 * Pressing it sends a plain chat message — "Yes, go ahead." — nothing more.
 * The server reads that against the proposal it stored on EVA's turn and
 * re-checks ownership of every id before acting; the button carries no
 * authority of its own. Typing the same words works identically.
 *
 * Only the newest turn shows buttons: a proposal the owner has already
 * answered is history, and its question still reads in the prose above.
 */
export function ActionProposalCard({
  block,
  isLatest,
}: {
  block: ActionProposalBlock
  isLatest: boolean
}) {
  const { t } = useI18n()
  const actions = useChatActions()
  if (!isLatest || !actions) return null

  const { action } = block
  const busy = actions.busy

  if (action.kind === 'campaign.choose') {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[13px] text-muted-foreground">{t('chat.chooseCampaign')}</span>
        {action.choices.map((choice) => (
          <Button
            key={choice.campaignId}
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => actions.sendQuickReply(t('chat.quickUseCampaign', { name: choice.name }))}
          >
            {choice.name}
          </Button>
        ))}
      </div>
    )
  }

  return (
    <div>
      <Button size="sm" disabled={busy} onClick={() => actions.sendQuickReply(t('chat.quickYes'))}>
        {block.confirmLabel}
        <ArrowRight className="size-3.5" aria-hidden />
      </Button>
    </div>
  )
}
