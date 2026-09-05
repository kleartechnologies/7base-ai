import { Link } from 'react-router-dom'
import {
  FolderOpen,
  Image,
  Lightbulb,
  Megaphone,
  MessageSquare,
  type LucideIcon,
} from 'lucide-react'
import { EvaSpark } from '@/components/EvaMark'
import { ROUTES } from '@/app/routes/paths'
import { useAuth } from '@/hooks/useAuth'
import { useI18n } from '@/hooks/useI18n'
import type { MessageKey } from '@/i18n/translate'
import { greetingKey } from './greeting'

/**
 * The first thing a user sees: a time-of-day eyebrow with EVA's spark, one
 * question, suggestion chips that start a conversation, and the "Explore what
 * you can do" cards into the workspace.
 */

const SUGGESTIONS: readonly { labelKey: MessageKey; promptKey: MessageKey; icon: LucideIcon }[] = [
  { labelKey: 'chat.chipIdeas', promptKey: 'chat.suggestionSlowSales', icon: Lightbulb },
  { labelKey: 'chat.chipCampaign', promptKey: 'chat.suggestionNewItem', icon: Megaphone },
  { labelKey: 'chat.chipVisual', promptKey: 'chat.promptVisual', icon: Image },
  { labelKey: 'chat.chipProfile', promptKey: 'chat.promptProfile', icon: MessageSquare },
]

const EXPLORE_CARDS: readonly {
  titleKey: MessageKey
  bodyKey: MessageKey
  to: string
  icon: LucideIcon
}[] = [
  { titleKey: 'nav.business', bodyKey: 'chat.exploreBusinessBody', to: ROUTES.business, icon: MessageSquare },
  { titleKey: 'nav.campaigns', bodyKey: 'chat.exploreCampaignsBody', to: ROUTES.campaigns, icon: Megaphone },
  { titleKey: 'nav.creative', bodyKey: 'chat.exploreCreativeBody', to: ROUTES.creative, icon: Image },
  { titleKey: 'chat.exploreAssetsTitle', bodyKey: 'chat.exploreAssetsBody', to: ROUTES.assets, icon: FolderOpen },
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

/** "Explore what you can do" — four doors into the workspace. */
export function ExploreGrid() {
  const { t } = useI18n()
  return (
    <div className="mx-auto mt-12 w-full max-w-3xl">
      <p className="text-left text-[14px] font-semibold tracking-[-0.01em] text-foreground">
        {t('chat.exploreTitle')}
      </p>
      <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {EXPLORE_CARDS.map(({ titleKey, bodyKey, to, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            className="rounded-[13px] border border-border bg-card p-4 text-left transition-colors hover:border-ring/50"
          >
            <Icon className="size-[18px] text-muted-foreground" aria-hidden />
            <p className="mt-3 text-[14px] font-semibold text-foreground">{t(titleKey)}</p>
            <p className="mt-1 text-[12.5px] leading-normal text-muted-foreground">{t(bodyKey)}</p>
          </Link>
        ))}
      </div>
    </div>
  )
}
