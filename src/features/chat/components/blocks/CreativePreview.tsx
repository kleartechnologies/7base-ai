import { useEffect, useState } from 'react'
import { Download, ImageOff, Images, RefreshCw } from 'lucide-react'
import { copyTextToClipboard, downloadCreativePoster } from '@/features/creative/poster'
import { firstUsableColor, readableTextOn } from '@/features/creative/posterSpec'
import { retryCreativeImage } from '@/services/ai/ai.client'
import { getAssetUrl } from '@/services/storage/storage.service'
import { Button } from '@/components/ui/button'
import type { CreativePreviewBlock } from '@/types'

/**
 * A creative in the conversation: the poster and its captions together, one
 * complete marketing package.
 *
 * The poster preview is composed live from the structured fields over the
 * stored visual — the same layout the canvas export draws — so what the owner
 * sees is what downloads, and a text edit updates the preview without ever
 * touching the image. A generated visual is labelled as generated; honesty
 * over polish.
 */
export function CreativePreview({ block }: { block: CreativePreviewBlock }) {
  // The resolved URL and any load failure are keyed by the storage path, so a
  // changed image simply stops matching — no state reset inside the effect.
  const storagePath = block.image?.storagePath ?? null
  const [resolved, setResolved] = useState<{ path: string; url: string } | null>(null)
  const [failedPath, setFailedPath] = useState<string | null>(null)
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [retryNote, setRetryNote] = useState<string | null>(null)

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
        creativeId: block.creativeId,
        content: {
          name: block.name,
          format: block.format,
          headline: block.headline,
          subheadline: block.subheadline,
          callToAction: block.callToAction,
          offerText: block.offerText,
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

  const handleRetry = async () => {
    setRetrying(true)
    setRetryNote(null)
    const result = await retryCreativeImage({ creativeId: block.creativeId })
    setRetrying(false)
    if (!result.ok) {
      setRetryNote(result.error.message)
    } else if (!result.data.imageReady) {
      setRetryNote('The image still could not be created. Your copy is untouched — try again in a moment.')
    }
    // On success the updated preview arrives as a new message in the thread.
  }

  const accent = firstUsableColor(null) ?? '#C2410C'
  const accentText = readableTextOn(accent)

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="border-b border-border px-5 py-3">
        <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
          <Images className="size-3.5" aria-hidden />
          Marketing materials
          {block.image?.source === 'generated' ? (
            <span className="ml-auto rounded-full border border-border px-1.5 py-px text-[10px] font-normal normal-case tracking-normal text-muted-foreground">
              AI-generated image
            </span>
          ) : block.image?.source === 'upload' ? (
            <span className="ml-auto rounded-full border border-border px-1.5 py-px text-[10px] font-normal normal-case tracking-normal text-muted-foreground">
              Your photo
            </span>
          ) : null}
        </p>
        <h3 className="mt-1 text-[16px] font-semibold tracking-[-0.01em] text-foreground">
          {block.name}
        </h3>
      </div>

      {/* The poster: visual + live text overlay, same layout the export draws. */}
      <div className="px-5 pt-4">
        <div
          className={`relative w-full max-w-sm overflow-hidden rounded-lg bg-[#20242b] ${
            block.format === 'portrait_post' ? 'aspect-[4/5]' : 'aspect-square'
          }`}
        >
          {imageUrl && !imageLoadFailed ? (
            <img
              src={imageUrl}
              alt={block.image?.altText ?? block.headline ?? block.name}
              className="absolute inset-0 size-full object-cover"
              onError={() => setFailedPath(storagePath)}
            />
          ) : block.image && !imageLoadFailed ? (
            <div className="absolute inset-0 animate-pulse bg-muted" aria-hidden />
          ) : null}

          <div
            className="absolute inset-x-0 bottom-0 h-3/5 bg-gradient-to-t from-black/80 via-black/40 to-transparent"
            aria-hidden
          />

          {block.offerText ? (
            <span
              className="absolute left-4 top-4 rounded-md px-2.5 py-1 text-[12px] font-semibold"
              style={{ backgroundColor: accent, color: accentText }}
            >
              {block.offerText}
            </span>
          ) : null}

          <div className="absolute inset-x-0 bottom-0 p-4">
            {block.headline ? (
              <p className="text-[22px] font-bold leading-tight text-white">{block.headline}</p>
            ) : null}
            {block.subheadline ? (
              <p className="mt-1 text-[13px] leading-snug text-white/90">{block.subheadline}</p>
            ) : null}
            {block.callToAction ? (
              <span
                className="mt-2.5 inline-block rounded-full px-3 py-1 text-[12px] font-semibold"
                style={{ backgroundColor: accent, color: accentText }}
              >
                {block.callToAction}
              </span>
            ) : null}
          </div>
        </div>

        {block.imageFailed ? (
          <div className="mt-3 flex max-w-sm items-start gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-[13px] leading-relaxed text-muted-foreground">
            <ImageOff className="mt-px size-4 shrink-0" aria-hidden />
            <div>
              <p>The poster image couldn’t be created — your marketing copy below is ready to use.</p>
              <Button
                size="sm"
                variant="outline"
                className="mt-2"
                onClick={handleRetry}
                disabled={retrying}
              >
                <RefreshCw className={`size-3.5 ${retrying ? 'animate-spin' : ''}`} aria-hidden />
                {retrying ? 'Creating the image…' : 'Try the image again'}
              </Button>
              {retryNote ? <p className="mt-2">{retryNote}</p> : null}
            </div>
          </div>
        ) : null}
      </div>

      {/* Captions: each channel's copy, one click to use it. */}
      <div className="space-y-4 px-5 py-4">
        <Caption label="Facebook caption" text={block.captions.facebook} />
        <Caption label="Instagram caption" text={block.captions.instagram} />
        <Caption label="Short copy" text={block.captions.short} />
        <Caption label="WhatsApp message" text={block.captions.whatsapp} />
      </div>

      <div className="border-t border-border px-5 py-3.5">
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={handleDownload} disabled={downloading}>
            <Download className="size-3.5" aria-hidden />
            {downloading ? 'Preparing…' : 'Download Poster'}
          </Button>
        </div>
        {downloadError ? (
          <p className="mt-2 text-[13px] leading-relaxed text-destructive">
            The poster could not be downloaded. Please try again.
          </p>
        ) : null}
        <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
          Tell me what to change — the headline, the captions, or the image.
        </p>
      </div>
    </div>
  )
}

function Caption({ label, text }: { label: string; text: string | null }) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 2000)
    return () => window.clearTimeout(timer)
  }, [copied])

  if (!text) return null

  const handleCopy = async () => {
    if (await copyTextToClipboard(text)) setCopied(true)
  }

  return (
    <div>
      <p className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
        {label}
        <button
          type="button"
          onClick={handleCopy}
          className="ml-auto rounded-full border border-border px-2 py-px text-[11px] font-normal normal-case tracking-normal text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          {copied ? 'Copied.' : 'Copy'}
        </button>
      </p>
      <p className="mt-1 whitespace-pre-wrap text-[14px] leading-relaxed text-foreground">{text}</p>
    </div>
  )
}
