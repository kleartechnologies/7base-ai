import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Image as ImageIcon } from 'lucide-react'
import { ROUTES } from '@/app/routes/paths'
import { EvaSpark } from '@/components/EvaMark'
import { Button } from '@/components/ui/button'
import { CreativeCard } from '@/features/creative/CreativeCard'
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
