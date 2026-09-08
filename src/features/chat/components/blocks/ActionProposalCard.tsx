import { ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/hooks/useI18n'
import type { ActionProposalBlock } from '@/types'
import { useChatActions } from '../../chatActionsContext'

/**
 * The go-ahead for something EVA offered: one button, or one per campaign
 * when she needs the owner to pick.
 *
 * Phase 7J §6 — exactly one primary action, always. The summary line beside
 * it says the whole plan ("3 posters · Instagram & Facebook · Square"), and
 * the only other control is a quiet way to say "not like that", which puts
 * the cursor in the composer rather than opening a form of options.
 *
 * Pressing the primary sends a plain chat message — "Yes, go ahead." —
 * nothing more. The server reads that against the proposal it stored on
 * EVA's turn and re-checks ownership of every id before acting; the button
 * carries no authority of its own. Typing the same words works identically.
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
      /* The prose above already asked which campaign; the buttons answer it.
         Repeating the question as a label said it twice in one breath. */
      <div
        className="flex flex-wrap items-center gap-2"
        role="group"
        aria-label={t('chat.chooseCampaign')}
      >
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
    <div className="flex flex-wrap items-center gap-2.5">
      {/*
        The whole plan in one line — "3 posters · Instagram & Facebook ·
        Square" — written server-side in the owner's language. It is the
        only thing to read before pressing the button: no formats to pick,
        no campaign to understand, no options to configure.
      */}
      {block.summary ? (
        <span className="rounded-full border border-border px-2.5 py-1 text-[12px] text-muted-foreground">
          {block.summary}
        </span>
      ) : null}
      <Button size="sm" disabled={busy} onClick={() => actions.sendQuickReply(t('chat.quickYes'))}>
        {block.confirmLabel}
        <ArrowRight className="size-3.5" aria-hidden />
      </Button>
      {/*
        Not a second way to do the same thing (§6): it starts nothing, it
        just hands the owner the keyboard so they can say what to change.
      */}
      <Button
        size="sm"
        variant="ghost"
        className="text-muted-foreground"
        disabled={busy}
        onClick={() => document.getElementById('chat-composer')?.focus()}
      >
        {t('chat.changeSomething')}
      </Button>
    </div>
  )
}
