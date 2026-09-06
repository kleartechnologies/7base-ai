import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Download, ImageOff, Images } from 'lucide-react'
import { ROUTES } from '@/app/routes/paths'
import { downloadCreativePoster } from '@/features/creative/poster'
import { firstUsableColor, readableTextOn } from '@/features/creative/posterSpec'
import { getAssetUrl } from '@/services/storage/storage.service'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/hooks/useI18n'
import type { CreativeSetBlock, CreativeSetItem } from '@/types'

/**
 * Several posters EVA made in one go — the result card for "create 3 posters".
 *
 * A grid of the posters as they will download (visual plus the live text
 * overlay, same layout the export draws), the campaign they belong to, and
 * one door to the Creative page, which stays the canonical place to review,
 * edit and manage them. Says "2 of 3" plainly when fewer arrived; the prose
 * above explains and offers the retry.
 */
export function CreativeSetCard({ block }: { block: CreativeSetBlock }) {
  const { t } = useI18n()
  const created = block.items.length
  const partial = created < block.requested

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

      <div className="border-t border-border px-5 py-3.5">
        <Button size="sm" variant="outline" asChild>
          <Link to={ROUTES.creative}>{t('chat.viewAllCreatives')}</Link>
        </Button>
      </div>
    </div>
  )
}

function PosterTile({ item }: { item: CreativeSetItem }) {
  const { t } = useI18n()
  const storagePath = item.image?.storagePath ?? null
  const [resolved, setResolved] = useState<{ path: string; url: string } | null>(null)
  const [failedPath, setFailedPath] = useState<string | null>(null)
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState(false)

  const imageUrl = resolved && resolved.path === storagePath ? resolved.url : null
  const imageLoadFailed = storagePath !== null && failedPath === storagePath

  useEffect(() => {
    if (!storagePath) return
    let cancelled = false
    getAssetUrl(storagePath)
      .then((url) => {
        if (!cancelled) setResolved({ path: storagePath, url })
      })
      .catch(() => {
        if (!cancelled) setFailedPath(storagePath)
      })
    return () => {
      cancelled = true
    }
  }, [storagePath])

  const handleDownload = async () => {
    setDownloading(true)
    setDownloadError(false)
    try {
      await downloadCreativePoster({
        creativeId: item.creativeId,
        content: {
          name: item.name,
          format: item.format,
          headline: item.headline,
          subheadline: item.subheadline,
          callToAction: item.callToAction,
          offerText: item.offerText,
        },
        style: null,
        imageUrl,
      })
    } catch {
      setDownloadError(true)
    } finally {
      setDownloading(false)
    }
  }

  const accent = firstUsableColor(null) ?? '#C2410C'
  const accentText = readableTextOn(accent)

  return (
    <div className="min-w-0">
      <p className="mb-2 flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
        {t('chat.posterNumber', { index: item.position })}
        {item.imageFailed ? (
          <span className="flex items-center gap-1 rounded-full border border-border px-1.5 py-px text-[10px] font-normal normal-case tracking-normal">
            <ImageOff className="size-3" aria-hidden />
            {t('creative.imageFailed')}
          </span>
        ) : null}
      </p>
      <div
        className={`relative w-full overflow-hidden rounded-lg bg-poster-surface ${
          item.format === 'portrait_post' ? 'aspect-[4/5]' : 'aspect-square'
        }`}
      >
        {imageUrl && !imageLoadFailed ? (
          <img
            src={imageUrl}
            alt={item.image?.altText ?? item.headline ?? item.name}
            className="absolute inset-0 size-full object-cover"
            onError={() => setFailedPath(storagePath)}
          />
        ) : item.image && !imageLoadFailed ? (
          <div className="absolute inset-0 animate-pulse bg-muted" aria-hidden />
        ) : null}

        <div
          className="absolute inset-x-0 bottom-0 h-3/5 bg-gradient-to-t from-black/80 via-black/40 to-transparent"
          aria-hidden
        />

        {item.offerText ? (
          <span
            className="absolute left-3 top-3 rounded-md px-2 py-0.5 text-[11px] font-semibold"
            style={{ backgroundColor: accent, color: accentText }}
          >
            {item.offerText}
          </span>
        ) : null}

        <div className="absolute inset-x-0 bottom-0 p-3">
          {item.headline ? (
            <p className="text-[16px] font-bold leading-tight text-white">{item.headline}</p>
          ) : null}
          {item.subheadline ? (
            <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-white/90">
              {item.subheadline}
            </p>
          ) : null}
          {item.callToAction ? (
            <span
              className="mt-2 inline-block rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
              style={{ backgroundColor: accent, color: accentText }}
            >
              {item.callToAction}
            </span>
          ) : null}
        </div>
      </div>
      <p className="mt-2 truncate text-[13px] text-foreground" title={item.name}>
        {item.name}
      </p>
      <Button
        size="sm"
        variant="ghost"
        className="mt-1 -ml-2 h-7 px-2 text-[12px] text-muted-foreground"
        onClick={handleDownload}
        disabled={downloading}
      >
        <Download className="size-3.5" aria-hidden />
        {downloading ? t('creative.preparingDownload') : t('creative.downloadPoster')}
      </Button>
      {downloadError ? (
        <p className="mt-1 text-[12px] leading-relaxed text-destructive">
          {t('creative.downloadFailed')}
        </p>
      ) : null}
    </div>
  )
}
