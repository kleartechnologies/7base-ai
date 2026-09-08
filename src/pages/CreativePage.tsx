import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Download, Image as ImageIcon } from 'lucide-react'
import { ROUTES } from '@/app/routes/paths'
import { EvaSpark } from '@/components/EvaMark'
import { Button } from '@/components/ui/button'
import { BrandAppliedPanel } from '@/features/creative/BrandAppliedPanel'
import { PlatformCopy } from '@/features/creative/PlatformCopy'
import { PosterCanvas } from '@/features/creative/PosterCanvas'
import { downloadCreativePoster } from '@/features/creative/poster'
import { useAuth } from '@/hooks/useAuth'
import { useI18n } from '@/hooks/useI18n'
import { observeCampaigns } from '@/services/campaigns/campaign.service'
import { observeCreatives } from '@/services/creatives/creative.service'
import type { Creative } from '@/types'

/**
 * The owner's creative library: everything EVA has made, newest first.
 *
 * A place to see, download and pick up a creative — not where work starts.
 * Work starts by asking EVA; each card links back into the conversation so
 * changes go through the same authority model as creation. Every poster is
 * drawn by the shared renderer from its persisted document, so the card
 * here, the card in chat and the downloaded file are one picture.
 */
export default function CreativePage() {
  const { t } = useI18n()
  const { user } = useAuth()
  const [creatives, setCreatives] = useState<Creative[] | null>(null)
  const [campaignNames, setCampaignNames] = useState<Record<string, string>>({})
  const [loadError, setLoadError] = useState(false)

  useEffect(() => {
    if (!user) return
    // A dead listener must not masquerade as "no creatives yet".
    return observeCreatives(
      user.uid,
      (next) => {
        setCreatives(next)
        setLoadError(false)
      },
      () => setLoadError(true),
    )
  }, [user])

  useEffect(() => {
    if (!user) return
    // Campaign names answer "what was this for?"; a failure here only
    // drops that label, never the library.
    return observeCampaigns(
      user.uid,
      (campaigns) =>
        setCampaignNames(Object.fromEntries(campaigns.map((c) => [c.id, c.name]))),
      () => {},
    )
  }, [user])

  return (
    <div className="mx-auto w-full max-w-4xl px-5 py-8 sm:px-8 sm:py-12">
      <header>
        <h1 className="flex items-center gap-2.5 text-[22px] font-semibold tracking-[-0.01em] text-foreground">
          <ImageIcon className="size-5 text-muted-foreground" aria-hidden />
          {t('creative.pageTitle')}
        </h1>
        <p className="mt-1.5 max-w-xl text-[14px] leading-relaxed text-muted-foreground">
          {t('creative.pageIntro')}
        </p>
      </header>

      {loadError ? (
        <p role="alert" className="mt-10 text-[14px] leading-relaxed text-destructive">
          {t('creative.listLoadFailed')}
        </p>
      ) : creatives === null ? (
        <p className="mt-10 text-[14px] text-muted-foreground">{t('common.loadingEllipsis')}</p>
      ) : creatives.length === 0 ? (
        <div className="mx-auto mt-16 max-w-sm text-center">
          <EvaSpark className="mx-auto size-5 text-eva" aria-hidden />
          <h2 className="mt-4 text-[17px] font-semibold text-foreground">
            {t('creative.emptyTitle')}
          </h2>
          <p className="mt-2 text-[14px] leading-relaxed text-muted-foreground">
            {t('creative.emptyBody')}
          </p>
          <Button asChild size="lg" className="mt-6">
            <Link to={ROUTES.chat}>{t('creative.createWithEva')}</Link>
          </Button>
        </div>
      ) : (
        <ul className="mt-8 grid gap-6 sm:grid-cols-2">
          {creatives.map((creative) => (
            <li key={creative.id}>
              <CreativeCard creative={creative} campaignName={campaignNames[creative.campaignId ?? '']} />
            </li>
          ))}
          <li>
            <Link
              to={ROUTES.chat}
              className="flex h-full min-h-40 flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-border p-6 text-center transition-colors hover:border-foreground/30"
            >
              <EvaSpark className="size-4 text-eva" aria-hidden />
              <span className="text-[14px] font-medium text-foreground">
                {t('creative.needNewTitle')}
              </span>
              <span className="text-[12.5px] leading-relaxed text-muted-foreground">
                {t('creative.needNewBody')}
              </span>
            </Link>
          </li>
        </ul>
      )}
    </div>
  )
}

function CreativeCard({ creative, campaignName }: { creative: Creative; campaignName?: string }) {
  const { t, language } = useI18n()
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState(false)

  const handleDownload = async () => {
    setDownloading(true)
    setDownloadError(false)
    try {
      await downloadCreativePoster(creative)
    } catch {
      setDownloadError(true)
    } finally {
      setDownloading(false)
    }
  }

  const source = creative.content.image?.source
  const format =
    creative.format === 'portrait_post' ? t('creative.formatPortrait') : t('creative.formatSquare')
  const date = new Date(creative.updatedAt).toLocaleDateString(
    language === 'ms' ? 'ms-MY' : 'en-MY',
  )
  const context = [campaignName ? t('creative.forCampaign', { campaign: campaignName }) : null, format, date]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="w-full bg-poster-surface">
        <PosterCanvas creative={creative} className="block w-full" />
      </div>

      <div className="px-4 py-3.5">
        <div className="flex items-start gap-2">
          <h2 className="min-w-0 flex-1 text-[15px] font-semibold leading-snug tracking-[-0.01em] text-foreground">
            {creative.name}
          </h2>
          {source === 'generated' ? (
            <span className="shrink-0 rounded-full border border-border px-1.5 py-px text-[10px] text-muted-foreground">
              {t('creative.aiGeneratedImage')}
            </span>
          ) : source === 'upload' ? (
            <span className="shrink-0 rounded-full border border-border px-1.5 py-px text-[10px] text-muted-foreground">
              {t('creative.yourPhoto')}
            </span>
          ) : null}
        </div>
        <p className="mt-0.5 text-[12px] text-muted-foreground">{context}</p>

        {/* The poster's own copy, directly under it. Collapsed by default —
            the poster is what this page is for. */}
        <PlatformCopy creative={creative} className="mt-3" />

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => void handleDownload()} disabled={downloading}>
            <Download className="size-3.5" aria-hidden />
            {downloading ? t('creative.preparingDownload') : t('creative.downloadPoster')}
          </Button>
          <Button size="sm" variant="outline" asChild>
            <Link
              to={creative.conversationId ? ROUTES.conversation(creative.conversationId) : ROUTES.chat}
            >
              <EvaSpark className="size-3.5 text-eva" aria-hidden />
              {t('creative.editInChat')}
            </Link>
          </Button>
        </div>
        {downloadError ? (
          <p className="mt-2 text-[12px] text-destructive">{t('creative.downloadFailed')}</p>
        ) : null}

        {/* Only creatives generated after Brand Identity shipped carry the
            server-stamped summary; older ones simply show nothing here. */}
        {creative.style.brandApplied ? (
          <BrandAppliedPanel applied={creative.style.brandApplied} />
        ) : null}
      </div>
    </div>
  )
}
