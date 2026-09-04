import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Copy, Check, LibraryBig } from 'lucide-react'
import { ROUTES } from '@/app/routes/paths'
import { copyTextToClipboard } from '@/features/creative/poster'
import {
  COPY_CHANNEL_LABELS,
  LIBRARY_TABS,
  filterByTab,
  type LibraryItem,
  type LibraryTab,
} from '@/features/library/libraryItem'
import { useLibrary } from '@/features/library/useLibrary'
import { useAuth } from '@/hooks/useAuth'
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
const TYPE_LABELS: Record<LibraryItem['type'], string> = {
  creative: 'Poster',
  copy: 'Caption',
  campaign: 'Campaign',
  recommendation: 'Idea',
}

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  generating: 'Generating',
  ready: 'Ready',
  failed: 'Failed',
  archived: 'Archived',
}

const EMPTY_COPY: Record<LibraryTab, string> = {
  all: 'No marketing work yet. Ask EVA in the chat — the recommendations, campaigns, posters and captions you build together are collected here.',
  creatives:
    'No creatives yet. Open a campaign and choose “Create Marketing Materials” — posters land here.',
  copywriting:
    'No copywriting yet. Captions arrive together with each creative EVA makes.',
  campaigns:
    'No campaigns yet. When EVA recommends a move in the chat, one click turns it into a campaign.',
  recommendations: 'No recommendations yet. Ask EVA what you want to achieve.',
}

export default function LibraryPage() {
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
          Library
        </h1>
        <p className="mt-1.5 max-w-xl text-[14px] leading-relaxed text-muted-foreground">
          Everything EVA has created for your business, in one place — newest first.
        </p>
      </header>

      <div className="mt-6 flex flex-wrap gap-1.5" role="tablist" aria-label="Library sections">
        {LIBRARY_TABS.map(({ tab: t, label }) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`rounded-full border px-3 py-1 text-[13px] transition-colors ${
              tab === t
                ? 'border-foreground bg-foreground text-background'
                : 'border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {failedSources.length > 0 && !allFailed ? (
        <p className="mt-4 text-[13px] text-destructive">
          Some of your work could not be loaded ({failedSources.join(', ')}). The rest is shown
          below — refresh to try again.
        </p>
      ) : null}

      {loading ? (
        <p className="mt-10 text-[14px] text-muted-foreground">Loading…</p>
      ) : allFailed ? (
        <p className="mt-10 max-w-xl text-[14px] leading-relaxed text-destructive">
          Your library could not be loaded. Check your connection and refresh to try again.
        </p>
      ) : visible.length === 0 ? (
        <p className="mt-10 max-w-xl text-[14px] leading-relaxed text-muted-foreground">
          {EMPTY_COPY[tab]}
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

  const statusLabel =
    item.type === 'recommendation'
      ? builtCampaignId
        ? 'Campaign built'
        : 'Proposed'
      : item.status
        ? (STATUS_LABELS[item.status] ?? null)
        : null

  return (
    <Link
      to={to}
      className="flex gap-4 rounded-xl border border-border bg-card px-5 py-4 transition-colors hover:border-foreground/20"
    >
      {item.type === 'creative' ? <CreativeThumb item={item} /> : null}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            {TYPE_LABELS[item.type]}
          </span>
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
          Updated {new Date(item.updatedAt).toLocaleDateString()}
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
          {item.channel ? COPY_CHANNEL_LABELS[item.channel] : TYPE_LABELS.copy}
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
          {copied ? 'Copied' : 'Copy text'}
        </Button>
        {item.conversationId ? (
          <Button size="sm" variant="ghost" asChild>
            <Link to={ROUTES.conversation(item.conversationId)}>Edit in chat</Link>
          </Button>
        ) : null}
        <span className="ml-auto text-[12px] text-muted-foreground">
          {campaignName ? `${campaignName} · ` : ''}
          {new Date(item.updatedAt).toLocaleDateString()}
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
    <div className="size-16 shrink-0 overflow-hidden rounded-lg bg-[#20242b]">
      {imageUrl ? (
        <img src={imageUrl} alt="" className="size-full object-cover" />
      ) : null}
    </div>
  )
}
