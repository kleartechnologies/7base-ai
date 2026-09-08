import { Image, Lightbulb, Megaphone, Users, type LucideIcon } from 'lucide-react'
import { EvaSpark } from '@/components/EvaMark'
import { useAuth } from '@/hooks/useAuth'
import { useI18n } from '@/hooks/useI18n'
import type { MessageKey } from '@/i18n/translate'
import { greetingKey } from './greeting'

/**
 * The first thing a user sees: a time-of-day eyebrow with EVA's spark, one
 * question, and four ways to answer it.
 *
 * The chips are goals, not features (Phase 7J §15): "More customers this
 * weekend", never "Create a campaign". Nobody opening this product for the
 * first time knows what a campaign is here, and they shouldn't need to —
 * they know what they want to happen to their business this weekend.
 *
 * There is deliberately no tour of the workspace here. A grid of Business
 * Brain / Campaigns / Creative / Assets cards was the product explaining its
 * own architecture on the one screen that should say "just tell me what you
 * want" (§1/§16); those pages are a click away in the nav for anyone who
 * wants them.
 */

const SUGGESTIONS: readonly { labelKey: MessageKey; promptKey: MessageKey; icon: LucideIcon }[] = [
  { labelKey: 'chat.chipCustomers', promptKey: 'chat.promptCustomers', icon: Users },
  { labelKey: 'chat.chipSomethingNew', promptKey: 'chat.promptSomethingNew', icon: Megaphone },
  { labelKey: 'chat.chipPoster', promptKey: 'chat.promptPoster', icon: Image },
  { labelKey: 'chat.chipQuiet', promptKey: 'chat.promptQuiet', icon: Lightbulb },
]


export function EmptyState() {
  const { user } = useAuth()
  const { t } = useI18n()
  const firstName = user?.displayName?.trim().split(/\s+/)[0]

  return (
    <div className="mx-auto w-full max-w-3xl text-center">
      <p className="inline-flex items-center gap-2 text-[12px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
        <EvaSpark className="size-[13px] text-eva" />
        {t(greetingKey(Boolean(firstName), new Date().getHours()), { name: firstName ?? '' })}
      </p>
      <h1 className="mx-auto mt-4 max-w-[560px] text-balance text-[28px] font-semibold leading-[1.15] tracking-[-0.02em] text-foreground sm:text-[36px]">
        {t('chat.emptyTitle')}
      </h1>
      <p className="mx-auto mt-3 max-w-md text-[15px] leading-relaxed text-muted-foreground">
        {t('chat.emptySubtitle')}
      </p>
    </div>
  )
}

/** The suggestion chips under the composer. */
export function SuggestionChips({ onPick }: { onPick: (text: string) => void }) {
  const { t } = useI18n()
  return (
    <div className="mt-3.5 flex flex-wrap justify-center gap-2">
      {SUGGESTIONS.map(({ labelKey, promptKey, icon: Icon }) => (
        <button
          key={labelKey}
          type="button"
          onClick={() => onPick(t(promptKey))}
          className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-border bg-card px-3.5 py-2 text-[13px] text-muted-foreground transition-colors hover:border-ring/50 hover:text-foreground"
        >
          <Icon className="size-3.5" aria-hidden />
          {t(labelKey)}
        </button>
      ))}
    </div>
  )
}

