import { Link } from 'react-router-dom'
import { ROUTES } from '@/app/routes/paths'
import { EvaSpark } from '@/components/EvaMark'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/hooks/useI18n'
import type { MessageKey } from '@/i18n/translate'
import { cn } from '@/lib/utils'
import type { Creative } from '@/types'
import { BrandAppliedPanel } from './BrandAppliedPanel'
import { DownloadPosterButton } from './LivePoster'
import { PlatformCopy } from './PlatformCopy'
import { PosterCanvas } from './PosterCanvas'

/**
 * One creative, whole: the poster, what it is, its copy, and the two things
 * an owner can actually do with it.
 *
 * There is exactly one of these. The library and the campaign workspace show
 * the same creative, so they show it the same way — a second, thinner card on
 * the campaign page would drift from this one and quietly disagree about what
 * a creative is.
 *
 * The poster stays dominant: it is the full width of the card, with the copy
 * folded away underneath until asked for. Actions are limited to what works
 * end to end today — download the poster, or pick the creative up in the
 * conversation that made it. No publish, no schedule, no boost.
 *
 * The creative is passed in, never fetched: both pages already hold an
 * owner-scoped listener, and a per-card subscription would turn one read into
 * one per poster on screen.
 */
export function CreativeCard({
  creative,
  campaignName,
  anchorId,
  copyOpen = false,
  className,
}: {
  creative: Creative
  /** Shown only where the campaign is not already obvious from the page. */
  campaignName?: string
  /** Scroll target, so a "Review copy" action can land on this card. */
  anchorId?: string
  /** Opens this creative's copy panel — see PlatformCopy's `defaultOpen`. */
  copyOpen?: boolean
  className?: string
}) {
  const { t, language } = useI18n()

  const source = creative.content.image?.source
  const format =
    creative.format === 'portrait_post' ? t('creative.formatPortrait') : t('creative.formatSquare')
  const date = new Date(creative.updatedAt).toLocaleDateString(
    language === 'ms' ? 'ms-MY' : 'en-MY',
  )
  const context = [
    campaignName ? t('creative.forCampaign', { campaign: campaignName }) : null,
    format,
    date,
  ]
    .filter(Boolean)
    .join(' · ')

  // Only the states that mean something is still owed. A finished creative
  // wears no badge at all.
  const statusKey: MessageKey | null =
    creative.status === 'generating'
      ? 'library.statusGenerating'
      : creative.status === 'draft'
        ? 'library.statusDraft'
        : creative.status === 'failed'
          ? 'library.statusFailed'
          : null

  return (
    <div
      id={anchorId}
      className={cn('overflow-hidden rounded-xl border border-border bg-card', className)}
    >
      <div className="w-full bg-poster-surface">
        <PosterCanvas creative={creative} className="block w-full" />
      </div>

      <div className="px-4 py-3.5">
        <div className="flex items-start gap-2">
          <h3 className="min-w-0 flex-1 text-[15px] font-semibold leading-snug tracking-[-0.01em] text-foreground">
            {creative.name}
          </h3>
          {statusKey ? <Pill>{t(statusKey)}</Pill> : null}
          {source === 'generated' ? (
            <Pill>{t('creative.aiGeneratedImage')}</Pill>
          ) : source === 'upload' ? (
            <Pill>{t('creative.yourPhoto')}</Pill>
          ) : null}
        </div>
        <p className="mt-0.5 text-[12px] text-muted-foreground">{context}</p>

        {/* The poster's own copy, directly under it — never pooled with the
            other creatives in the campaign. Collapsed by default, because the
            poster is what the owner came to look at. */}
        <PlatformCopy creative={creative} defaultOpen={copyOpen} className="mt-3" />

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <DownloadPosterButton creative={creative} />
          <Button size="sm" variant="outline" asChild>
            <Link
              to={
                creative.conversationId ? ROUTES.conversation(creative.conversationId) : ROUTES.chat
              }
            >
              <EvaSpark className="size-3.5 text-eva" aria-hidden />
              {t('creative.editInChat')}
            </Link>
          </Button>
        </div>

        {/* Only creatives generated after Brand Identity shipped carry the
            server-stamped summary; older ones simply show nothing here. */}
        {creative.style.brandApplied ? (
          <BrandAppliedPanel applied={creative.style.brandApplied} />
        ) : null}
      </div>
    </div>
  )
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="shrink-0 rounded-full border border-border px-1.5 py-px text-[10px] text-muted-foreground">
      {children}
    </span>
  )
}
