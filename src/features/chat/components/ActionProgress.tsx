import { Check, X } from 'lucide-react'
import { useI18n } from '@/hooks/useI18n'
import type { ActionProgressStep } from '@/types'
import type { MessageKey } from '@/i18n/messages/en'
import { EvaTurn } from './EvaTurn'

const STEP_LABEL: Record<Exclude<ActionProgressStep['key'], 'poster'>, MessageKey> = {
  campaign: 'chat.progressCampaign',
  campaign_create: 'chat.progressCampaignCreate',
  brand: 'chat.progressBrand',
  assets: 'chat.progressAssets',
  concepts: 'chat.progressConcepts',
}

/**
 * EVA at work: the steps of an action as the backend reports them.
 *
 * Replaces the thinking line while posters are being made, so a wait of a
 * minute or two reads as progress rather than silence. Each line is in the
 * owner's language and says what happened for their business — campaign
 * selected, Brand Identity applied, poster 2 of 3 — never which model,
 * task or quota did the work. Steps are display only; the result arrives
 * as a stored message like any other reply.
 */
export function ActionProgress({ steps }: { steps: ActionProgressStep[] }) {
  const { t } = useI18n()
  return (
    <div role="status" aria-label={t('chat.working')}>
      <EvaTurn markState="thinking">
        <ol className="space-y-1.5">
          {steps.map((step, index) => (
            <li
              key={`${step.key}-${step.index ?? index}`}
              className={`flex items-center gap-2.5 text-[14px] leading-[1.5] ${
                step.state === 'active' ? 'text-foreground' : 'text-muted-foreground'
              }`}
            >
              <StepMark state={step.state} />
              <span
                className={
                  step.state === 'active' ? 'animate-eva-pulse motion-reduce:animate-none' : ''
                }
              >
                {labelFor(step, t)}
              </span>
            </li>
          ))}
        </ol>
      </EvaTurn>
    </div>
  )
}

function labelFor(step: ActionProgressStep, t: ReturnType<typeof useI18n>['t']): string {
  if (step.key === 'poster') {
    const params = { index: step.index ?? 1, total: step.total ?? 1 }
    if (step.state === 'done') return t('chat.progressPosterDone', params)
    if (step.state === 'failed') return t('chat.progressPosterFailed', params)
    return t('chat.progressPoster', params)
  }
  const label = t(STEP_LABEL[step.key])
  return step.state === 'failed' ? `${label} — ${t('chat.progressFailed')}` : label
}

/** ✓ done, ◌ in progress or waiting, ✕ failed — the marks the spec names. */
function StepMark({ state }: { state: ActionProgressStep['state'] }) {
  if (state === 'done') {
    return (
      <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-eva/15 text-eva">
        <Check className="size-3" strokeWidth={2.5} aria-hidden />
      </span>
    )
  }
  if (state === 'failed') {
    return (
      <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <X className="size-3" strokeWidth={2.5} aria-hidden />
      </span>
    )
  }
  return (
    <span
      className={`size-4 shrink-0 rounded-full border-[1.5px] ${
        state === 'active'
          ? 'border-eva border-t-transparent animate-spin motion-reduce:animate-none'
          : 'border-border'
      }`}
      aria-hidden
    />
  )
}
