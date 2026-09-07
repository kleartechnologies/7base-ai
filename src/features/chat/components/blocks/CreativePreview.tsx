import { useEffect, useState } from 'react'
import { ImageOff, Images, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DownloadPosterButton, LivePosterFrame, useLivePoster } from '@/features/creative/LivePoster'
import { copyTextToClipboard } from '@/features/creative/poster'
import { useI18n } from '@/hooks/useI18n'
import { retryCreativeImage } from '@/services/ai/ai.client'
import type { CreativePreviewBlock } from '@/types'

/**
 * A creative in the conversation: the poster and its captions together, one
 * complete marketing package.
 *
 * The poster is the persisted creative, drawn by the shared renderer — the
 * same picture the Creative page shows and the download exports. Captions
 * come from the document too once it has loaded, so an edit shows here
 * without a new message. A generated visual is labelled as EVA's; honesty
 * over polish.
 */
export function CreativePreview({ block }: { block: CreativePreviewBlock }) {
  const { t } = useI18n()
  const lookup = useLivePoster(block.creativeId)
  const creative = lookup.status === 'ready' ? lookup.creative : null
  const [retrying, setRetrying] = useState(false)
  const [retryNote, setRetryNote] = useState<string | null>(null)

  const source = creative ? creative.content.image?.source : block.image?.source
  const imageFailed = creative ? creative.imageError !== null : block.imageFailed
  const captions = creative ? creative.captions : block.captions

  const handleRetry = async () => {
    setRetrying(true)
    setRetryNote(null)
    const result = await retryCreativeImage({ creativeId: block.creativeId })
    setRetrying(false)
    if (!result.ok) {
      setRetryNote(result.error.message)
    } else if (!result.data.imageReady) {
      setRetryNote(t('creative.retryStillFailed'))
    }
    // On success the creative updates in place and a new message confirms it.
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="border-b border-border px-5 py-3">
        <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
          <Images className="size-3.5" aria-hidden />
          {t('creative.marketingMaterials')}
          {source === 'generated' ? (
            <span className="ml-auto rounded-full border border-border px-1.5 py-px text-[10px] font-normal normal-case tracking-normal text-muted-foreground">
              {t('creative.aiGeneratedImage')}
            </span>
          ) : source === 'upload' ? (
            <span className="ml-auto rounded-full border border-border px-1.5 py-px text-[10px] font-normal normal-case tracking-normal text-muted-foreground">
              {t('creative.yourPhoto')}
            </span>
          ) : null}
        </p>
        <h3 className="mt-1 text-[16px] font-semibold tracking-[-0.01em] text-foreground">
          {creative ? creative.name : block.name}
        </h3>
      </div>

      {/* The poster, as it will download. */}
      <div className="px-5 pt-4">
        <LivePosterFrame lookup={lookup} format={block.format} className="max-w-sm" />

        {imageFailed ? (
          <div className="mt-3 flex max-w-sm items-start gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-[13px] leading-relaxed text-muted-foreground">
            <ImageOff className="mt-px size-4 shrink-0" aria-hidden />
            <div>
              <p>{t('creative.imageFailed')}</p>
              <Button
                size="sm"
                variant="outline"
                className="mt-2"
                onClick={handleRetry}
                disabled={retrying}
              >
                <RefreshCw className={`size-3.5 ${retrying ? 'animate-spin' : ''}`} aria-hidden />
                {retrying ? t('creative.retryingImage') : t('creative.retryImage')}
              </Button>
              {retryNote ? <p className="mt-2">{retryNote}</p> : null}
            </div>
          </div>
        ) : null}
      </div>

      {/* Captions: each channel's copy, one click to use it. */}
      <div className="space-y-4 px-5 py-4">
        <Caption label={t('creative.captionFacebook')} text={captions.facebook} />
        <Caption label={t('creative.captionInstagram')} text={captions.instagram} />
        <Caption label={t('creative.captionShort')} text={captions.short} />
        <Caption label={t('creative.captionWhatsapp')} text={captions.whatsapp} />
      </div>

      <div className="border-t border-border px-5 py-3.5">
        <div className="flex flex-wrap items-center gap-2">
          <DownloadPosterButton creative={creative} />
        </div>
        <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
          {t('creative.editHint')}
        </p>
      </div>
    </div>
  )
}

function Caption({ label, text }: { label: string; text: string | null }) {
  const { t } = useI18n()
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
          {copied ? t('creative.copied') : t('creative.copy')}
        </button>
      </p>
      <p className="mt-1 whitespace-pre-wrap text-[14px] leading-relaxed text-foreground">{text}</p>
    </div>
  )
}
