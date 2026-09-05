import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Copy, Check, LibraryBig } from 'lucide-react'
import { ROUTES } from '@/app/routes/paths'
import { EvaSpark } from '@/components/EvaMark'
import { copyTextToClipboard } from '@/features/creative/poster'
import {
  COPY_CHANNEL_LABEL_KEYS,
  LIBRARY_TABS,
  filterByTab,
  type LibraryItem,
  type LibraryTab,
} from '@/features/library/libraryItem'
import { useLibrary } from '@/features/library/useLibrary'
import { useAuth } from '@/hooks/useAuth'
import { useI18n } from '@/hooks/useI18n'
import type { MessageKey } from '@/i18n/translate'
import { getAssetUrl } from '@/services/storage/storage.service'
import { Button } from '@/components/ui/button'

/**
 * EVA Library: one place to find everything MARKA has created — recent
 * first, across creatives, captions, campaigns and recommendations.
 *
 * Strictly a view: the page runs the same per-owner realtime queries the
 * workspace tabs already use and merges them client-side. Nothing here
 * writes, generates, or calls AI; every card links back to the existing
 * surface where the object is actually worked on (campaign detail, or the
 * conversation where editing happens).
 */

/** Owner-facing names, not schema names. */
const TYPE_KEYS: Record<LibraryItem['type'], MessageKey> = {
  creative: 'library.typePoster',
  copy: 'library.typeCaption',
  campaign: 'library.typeCampaign',
  recommendation: 'library.typeIdea',
}

const STATUS_KEYS: Record<string, MessageKey> = {
  draft: 'library.statusDraft',
  generating: 'library.statusGenerating',
  ready: 'library.statusReady',
  failed: 'library.statusFailed',
  archived: 'library.statusArchived',
}

const EMPTY_KEYS: Record<LibraryTab, MessageKey> = {
  all: 'library.emptyAll',
  creatives: 'library.emptyCreatives',
  copywriting: 'library.emptyCopywriting',
  campaigns: 'library.emptyCampaigns',
  recommendations: 'library.emptyRecommendations',
}

/** `failedSources` carries stable source ids; name them in the UI language. */
const SOURCE_KEYS: Record<string, MessageKey> = {
  creatives: 'library.tabCreatives',
  campaigns: 'library.tabCampaigns',
  recommendations: 'library.tabRecommendations',
}

export default function LibraryPage() {
  const { t } = useI18n()
  const { user } = useAuth()
  const [tab, setTab] = useState<LibraryTab>('all')
  const { items, campaignNames, builtByRecommendation, loading, failedSources } = useLibrary(
    user?.uid ?? null,
  )

  const visible = filterByTab(items, tab)
  const allFailed = failedSources.length === 3

  return (
    <div className="mx-auto w-full max-w-3xl px-8 py-12">
      <header>
        <h1 className="flex items-center gap-2.5 text-[22px] font-semibold tracking-[-0.01em] text-foreground">
          <LibraryBig className="size-5 text-muted-foreground" aria-hidden />
          {t('library.pageTitle')}
        </h1>
        <p className="mt-1.5 max-w-xl text-[14px] leading-relaxed text-muted-foreground">
          {t('library.pageIntro')}
        </p>
      </header>

      <div
        className="mt-6 flex flex-wrap gap-1.5"
        role="tablist"
        aria-label={t('library.sectionsAria')}
      >
        {LIBRARY_TABS.map(({ tab: tabKey, labelKey }) => (
          <button
            key={tabKey}
            type="button"
            role="tab"
            aria-selected={tab === tabKey}
            onClick={() => setTab(tabKey)}
            className={`rounded-full border px-3 py-1 text-[13px] transition-colors ${
              tab === tabKey
                ? 'border-foreground bg-foreground text-background'
                : 'border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground'
            }`}
          >
            {t(labelKey)}
          </button>
        ))}
      </div>

      {failedSources.length > 0 && !allFailed ? (
        <p className="mt-4 text-[13px] text-destructive">
          {t('library.partialLoadFailed', {
            sources: failedSources
              .map((source) => (SOURCE_KEYS[source] ? t(SOURCE_KEYS[source]) : source))
              .join(', '),
          })}
        </p>
      ) : null}

      {loading ? (
        <p className="mt-10 text-[14px] text-muted-foreground">{t('common.loadingEllipsis')}</p>
      ) : allFailed ? (
        <p className="mt-10 max-w-xl text-[14px] leading-relaxed text-destructive">
          {t('library.loadFailed')}
        </p>
      ) : visible.length === 0 ? (
        <p className="mt-10 max-w-xl text-[14px] leading-relaxed text-muted-foreground">
          {/* The quoted button name comes from the same dictionary as the
              button itself, so the two can never drift apart. */}
          {t(EMPTY_KEYS[tab], { createMaterials: t('campaign.createMaterials') })}
        </p>
      ) : (
        <ul className="mt-8 space-y-3">
          {visible.map((item) => (
            <li key={item.key}>
              <LibraryCard
                item={item}
                campaignName={item.campaignId ? campaignNames.get(item.campaignId) : undefined}
                builtCampaignId={
                  item.type === 'recommendation' && item.recommendationId
                    ? builtByRecommendation.get(item.recommendationId)
                    : undefined
                }
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function LibraryCard({
  item,
  campaignName,
  builtCampaignId,
}: {
  item: LibraryItem
  campaignName?: string
  builtCampaignId?: string
}) {
  const { t, language } = useI18n()

  if (item.type === 'copy') {
    return <CopyCard item={item} campaignName={campaignName} />
  }

  // Where working on this object actually happens today: campaigns have a
  // detail page; creatives are edited conversationally; a recommendation
  // opens the campaign built from it, or its original conversation.
  const to =
    item.type === 'campaign'
      ? ROUTES.campaignDetail(item.sourceId)
      : item.type === 'recommendation'
        ? builtCampaignId
          ? ROUTES.campaignDetail(builtCampaignId)
          : item.conversationId
            ? ROUTES.conversation(item.conversationId)
            : ROUTES.chat
        : item.conversationId
          ? ROUTES.conversation(item.conversationId)
          : ROUTES.creative

  const statusKey = item.status ? STATUS_KEYS[item.status] : undefined
  const statusLabel =
    item.type === 'recommendation'
      ? builtCampaignId
        ? t('library.campaignBuilt')
        : t('library.proposed')
      : statusKey
        ? t(statusKey)
        : null

  return (
    <Link
      to={to}
      className="flex gap-4 rounded-xl border border-border bg-card px-5 py-4 transition-colors hover:border-foreground/20"
    >
      {item.type === 'creative' ? <CreativeThumb item={item} /> : null}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {item.type === 'recommendation' ? (
            // EVA-authored ideas carry her accent so they stand apart from
            // the owner's own material.
            <span className="flex shrink-0 items-center gap-1 rounded-full border border-eva-badge-border bg-eva-badge px-2 py-0.5 text-[11px] font-medium text-eva-badge-foreground">
              <EvaSpark className="size-3" aria-hidden />
              {t(TYPE_KEYS[item.type])}
            </span>
          ) : (
            <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
              {t(TYPE_KEYS[item.type])}
            </span>
          )}
          <h2 className="min-w-0 truncate text-[14px] font-semibold tracking-[-0.01em] text-foreground">
            {item.title}
          </h2>
          {statusLabel ? (
            <span className="ml-auto shrink-0 rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
              {statusLabel}
            </span>
          ) : null}
        </div>
        {item.preview ? (
          <p className="mt-1 line-clamp-2 text-[13px] leading-relaxed text-muted-foreground">
            {item.preview}
          </p>
        ) : null}
        <p className="mt-2 text-[12px] text-muted-foreground">
          {item.type !== 'campaign' && campaignName ? `${campaignName} · ` : ''}
          {t('library.updatedOn', {
            date: new Date(item.updatedAt).toLocaleDateString(
              language === 'ms' ? 'ms-MY' : 'en-MY',
            ),
          })}
        </p>
      </div>
    </Link>
  )
}

/**
 * Caption card. Not a link: its primary action is taking the text. The
 * caption renders from the creative document (the live source of truth),
 * never from a chat block snapshot.
 */
function CopyCard({ item, campaignName }: { item: LibraryItem; campaignName?: string }) {
  const { t, language } = useI18n()
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    if (!item.preview) return
    const ok = await copyTextToClipboard(item.preview)
    if (ok) {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card px-5 py-4">
      <div className="flex items-center gap-2">
        <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
          {item.channel ? t(COPY_CHANNEL_LABEL_KEYS[item.channel]) : t(TYPE_KEYS.copy)}
        </span>
        <h2 className="min-w-0 truncate text-[14px] font-semibold tracking-[-0.01em] text-foreground">
          {item.title}
        </h2>
      </div>
      {item.preview ? (
        <p className="mt-2 line-clamp-3 whitespace-pre-line text-[13px] leading-relaxed text-foreground/90">
          {item.preview}
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => void handleCopy()}>
          {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
          {copied ? t('library.copied') : t('library.copyText')}
        </Button>
        {item.conversationId ? (
          <Button size="sm" variant="ghost" asChild>
            <Link to={ROUTES.conversation(item.conversationId)}>{t('creative.editInChat')}</Link>
          </Button>
        ) : null}
        <span className="ml-auto text-[12px] text-muted-foreground">
          {campaignName ? `${campaignName} · ` : ''}
          {new Date(item.updatedAt).toLocaleDateString(language === 'ms' ? 'ms-MY' : 'en-MY')}
        </span>
      </div>
    </div>
  )
}

/**
 * Small poster thumbnail. Shows the creative's stored image snapshot — the
 * bytes live under the business's own creatives folder, so the preview never
 * depends on any upstream image still existing. Missing or unresolvable
 * images degrade to a quiet placeholder; nothing is regenerated.
 */
function CreativeThumb({ item }: { item: LibraryItem }) {
  const [resolved, setResolved] = useState<{ path: string; url: string } | null>(null)
  const imageUrl = resolved && resolved.path === item.imagePath ? resolved.url : null

  useEffect(() => {
    if (!item.imagePath) return
    let cancelled = false
    getAssetUrl(item.imagePath)
      .then((url) => {
        if (!cancelled && item.imagePath) setResolved({ path: item.imagePath, url })
      })
      .catch(() => {
        // Placeholder stays; the card is still fully usable without a visual.
      })
    return () => {
      cancelled = true
    }
  }, [item.imagePath])

  return (
    <div className="size-16 shrink-0 overflow-hidden rounded-lg bg-poster-surface">
      {imageUrl ? (
        <img src={imageUrl} alt="" className="size-full object-cover" />
      ) : null}
    </div>
  )
}
