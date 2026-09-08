import { Link } from 'react-router-dom'
import { ImageOff, Images } from 'lucide-react'
import { ROUTES } from '@/app/routes/paths'
import { Button } from '@/components/ui/button'
import { DownloadPosterButton, LivePosterFrame, useLivePoster } from '@/features/creative/LivePoster'
import { PlatformCopy } from '@/features/creative/PlatformCopy'
import { useI18n } from '@/hooks/useI18n'
import type { CreativeSetBlock, CreativeSetItem } from '@/types'
import { useChatActions } from '../../chatActionsContext'

/**
 * Several posters EVA made in one go — the result card for "create 3 posters".
 *
 * Each tile is the persisted creative itself, drawn by the shared renderer
 * (brand colours, real logo, chosen layout) exactly as the Creative page
 * draws it and the download exports it. The block only says which creatives
 * belong here; it never composes a poster of its own. Says "2 of 3" plainly
 * when fewer arrived; the prose above explains and offers the retry.
 *
 * The footer carries at most one suggestion of what to do next (Phase 7J
 * §12) — written server-side in the owner's language — beside the way out to
 * the Creative page. Pressing it just types that sentence to EVA.
 */
export function CreativeSetCard({ block }: { block: CreativeSetBlock }) {
  const { t } = useI18n()
  const actions = useChatActions()
  const created = block.items.length
  const partial = created < block.requested
  const followUp = block.followUp ?? null

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="border-b border-border px-5 py-3">
        <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
          <Images className="size-3.5" aria-hidden />
          {t('creative.marketingMaterials')}
          <span className="ml-auto rounded-full border border-border px-1.5 py-px text-[10px] font-normal normal-case tracking-normal text-muted-foreground">
            {partial
              ? t('chat.creativeSetPartial', { created, requested: block.requested })
              : t('chat.creativeSetCount', { count: created })}
          </span>
        </p>
        <h3 className="mt-1 text-[16px] font-semibold tracking-[-0.01em] text-foreground">
          {t('chat.creativeSetTitle', { campaign: block.campaignName })}
        </h3>
      </div>

      <div className="grid gap-4 px-5 py-4 sm:grid-cols-2 lg:grid-cols-3">
        {block.items.map((item) => (
          <PosterTile key={item.creativeId} item={item} />
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-border px-5 py-3.5">
        {followUp && actions ? (
          <Button
            size="sm"
            variant="outline"
            disabled={actions.busy}
            onClick={() => actions.sendQuickReply(followUp.text)}
          >
            {followUp.label}
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" className="text-muted-foreground" asChild>
          <Link to={ROUTES.creative}>{t('chat.viewAllCreatives')}</Link>
        </Button>
      </div>
    </div>
  )
}

function PosterTile({ item }: { item: CreativeSetItem }) {
  const { t } = useI18n()
  const lookup = useLivePoster(item.creativeId)
  const imageFailed = lookup.status === 'ready' ? lookup.creative.imageError !== null : item.imageFailed

  return (
    <div className="min-w-0">
      <p className="mb-2 flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
        {t('chat.posterNumber', { index: item.position })}
        {imageFailed ? (
          <span className="flex items-center gap-1 rounded-full border border-border px-1.5 py-px text-[10px] font-normal normal-case tracking-normal">
            <ImageOff className="size-3" aria-hidden />
            {t('creative.imageFailed')}
          </span>
        ) : null}
      </p>
      <LivePosterFrame lookup={lookup} format={item.format} />
      <p className="mt-2 truncate text-[13px] text-foreground" title={item.name}>
        {lookup.status === 'ready' ? lookup.creative.name : item.name}
      </p>
      <DownloadPosterButton
        creative={lookup.status === 'ready' ? lookup.creative : null}
        variant="ghost"
        className="mt-1 -ml-2 h-7 px-2 text-[12px] text-muted-foreground"
      />
      {/* Each poster keeps its own copy — never one pooled block per set. */}
      <PlatformCopy
        creative={lookup.status === 'ready' ? lookup.creative : null}
        className="mt-2"
      />
    </div>
  )
}
