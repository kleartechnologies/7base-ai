import { useState } from 'react'
import { Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/hooks/useI18n'
import type { Creative } from '@/types'
import { PosterCanvas } from './PosterCanvas'
import { downloadCreativePoster } from './poster'
import { useCreative, type CreativeLookup } from './useCreative'

/**
 * A creative referenced by id, drawn from its persisted document — the
 * building block every chat card uses. The chat never composes a poster
 * from the snapshot in its own message: it shows the creative the library
 * shows, by the same renderer, so the two can never disagree.
 */

export function useLivePoster(creativeId: string): CreativeLookup {
  return useCreative(creativeId)
}

export function LivePosterFrame({
  lookup,
  format,
  className = '',
}: {
  lookup: CreativeLookup
  format: 'square_post' | 'portrait_post'
  className?: string
}) {
  const { t } = useI18n()
  const aspect = format === 'portrait_post' ? 'aspect-[4/5]' : 'aspect-square'
  if (lookup.status === 'ready') {
    return (
      <div className={`w-full overflow-hidden rounded-lg bg-poster-surface ${className}`}>
        <PosterCanvas creative={lookup.creative} className="block w-full" />
      </div>
    )
  }
  return (
    <div className={`relative w-full overflow-hidden rounded-lg bg-poster-surface ${aspect} ${className}`}>
      {lookup.status === 'loading' ? (
        <div className="absolute inset-0 animate-pulse bg-muted" aria-hidden />
      ) : (
        <p className="absolute inset-0 flex items-center justify-center p-4 text-center text-[13px] text-muted-foreground">
          {t('creative.missing')}
        </p>
      )}
    </div>
  )
}

export function DownloadPosterButton({
  creative,
  variant = 'default',
  className,
}: {
  creative: Creative | null
  variant?: 'default' | 'ghost'
  className?: string
}) {
  const { t } = useI18n()
  const [downloading, setDownloading] = useState(false)
  const [failed, setFailed] = useState(false)

  const handleDownload = async () => {
    if (!creative) return
    setDownloading(true)
    setFailed(false)
    try {
      await downloadCreativePoster(creative)
    } catch {
      setFailed(true)
    } finally {
      setDownloading(false)
    }
  }

  return (
    <>
      <Button
        size="sm"
        variant={variant}
        className={className}
        onClick={() => void handleDownload()}
        disabled={downloading || !creative}
      >
        <Download className="size-3.5" aria-hidden />
        {downloading ? t('creative.preparingDownload') : t('creative.downloadPoster')}
      </Button>
      {failed ? (
        <p className="mt-1 text-[12px] leading-relaxed text-destructive">
          {t('creative.downloadFailed')}
        </p>
      ) : null}
    </>
  )
}
