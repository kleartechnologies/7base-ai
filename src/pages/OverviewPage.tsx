import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { ROUTES } from '@/app/routes/paths'
import { EvaSpark } from '@/components/EvaMark'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/hooks/useAuth'
import { useI18n } from '@/hooks/useI18n'
import type { MessageKey } from '@/i18n/translate'
import { suggestionKey } from '@/features/overview/suggestion'
import { missingQuestions } from '@/services/business/completion'
import { observeCampaigns } from '@/services/campaigns/campaign.service'
import { observeCreatives } from '@/services/creatives/creative.service'
import { getAssetUrl } from '@/services/storage/storage.service'
import type { Business, Campaign, Creative } from '@/types'

const STATUS_KEYS: Record<Campaign['status'], MessageKey> = {
  draft: 'campaign.statusDraft',
  ready: 'campaign.statusReady',
  archived: 'campaign.statusArchived',
}

/** Six questions EVA knows how to ask; `missingQuestions` reports the gaps. */
const PROFILE_QUESTION_TOTAL = 6

/**
 * The workspace at a glance: what EVA is working on, what she suggests next,
 * and how well she knows the business. Every card leads somewhere — the
 * conversation, a campaign, the profile — because this page is a doorway,
 * not a dashboard.
 */
export default function OverviewPage() {
  const { t } = useI18n()
  const { user, business } = useAuth()
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null)
  const [creatives, setCreatives] = useState<Creative[] | null>(null)

  useEffect(() => {
    if (!user) return
    return observeCampaigns(user.uid, setCampaigns, () => setCampaigns([]))
  }, [user])

  useEffect(() => {
    if (!user) return
    return observeCreatives(user.uid, setCreatives, () => setCreatives([]))
  }, [user])

  const activeCampaigns = (campaigns ?? []).filter((c) => c.status !== 'archived').slice(0, 4)
  const recentCreatives = (creatives ?? []).filter((c) => c.render).slice(0, 5)

  return (
    <div className="mx-auto w-full max-w-[860px] px-6 py-10 sm:px-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-semibold tracking-[-0.01em] text-foreground">
            {t('overview.title')}
          </h1>
          <p className="mt-1 text-[14px] leading-relaxed text-muted-foreground">
            {business
              ? t('overview.subtitle', { name: business.name })
              : t('overview.description')}
          </p>
        </div>
        <Button asChild>
          <Link to={ROUTES.chat}>
            <EvaSpark className="size-4 text-eva-on-dark" aria-hidden />
            {t('overview.askEva')}
          </Link>
        </Button>
      </header>

      <div className="mt-8 grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <div className="min-w-0 space-y-4">
          <section className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-foreground">
                {t('overview.activeCampaigns')}
              </h2>
              <Link
                to={ROUTES.campaigns}
                className="text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                {t('overview.viewAll')}
              </Link>
            </div>
            {campaigns === null ? (
              <p className="mt-4 text-[13px] text-muted-foreground">
                {t('common.loadingEllipsis')}
              </p>
            ) : activeCampaigns.length === 0 ? (
              <p className="mt-4 text-[13px] leading-relaxed text-muted-foreground">
                {t('overview.noCampaigns')}
              </p>
            ) : (
              <ul className="mt-3 divide-y divide-border">
                {activeCampaigns.map((campaign) => (
                  <li key={campaign.id}>
                    <Link
                      to={ROUTES.campaignDetail(campaign.id)}
                      className="group flex items-center gap-3 py-3"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[14px] font-medium text-foreground group-hover:underline">
                          {campaign.name}
                        </p>
                        {campaign.objective ? (
                          <p className="mt-0.5 truncate text-[12.5px] text-muted-foreground">
                            {campaign.objective}
                          </p>
                        ) : null}
                      </div>
                      <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
                        {t(STATUS_KEYS[campaign.status])}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-xl border border-border bg-card p-5">
            <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-foreground">
              {t('overview.recentCreative')}
            </h2>
            <div className="mt-3 grid grid-cols-3 gap-2.5">
              {recentCreatives.map((creative) => (
                <Link
                  key={creative.id}
                  to={ROUTES.creative}
                  aria-label={creative.name}
                  className="block overflow-hidden rounded-lg border border-border"
                >
                  <CreativeThumbnail creative={creative} />
                </Link>
              ))}
              <Link
                to={ROUTES.chat}
                className="flex aspect-square flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-border p-2 text-center text-[12px] leading-snug text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
              >
                <Plus className="size-4" aria-hidden />
                {t('overview.askNewVisual')}
              </Link>
            </div>
          </section>
        </div>

        <div className="min-w-0 space-y-4">
          <section className="rounded-xl border border-eva-tint-border bg-eva-tint p-5">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-eva-label">
              <EvaSpark className="size-3.5" aria-hidden />
              {t('overview.evaSuggests')}
            </p>
            <p className="mt-2.5 text-[14px] leading-relaxed text-foreground">
              {t(suggestionKey(business, campaigns))}
            </p>
            <Button asChild variant="outline" size="sm" className="mt-4 bg-transparent">
              <Link to={ROUTES.chat}>{t('overview.askAboutIt')}</Link>
            </Button>
          </section>

          {business ? <ProfileCard business={business} /> : null}
        </div>
      </div>
    </div>
  )
}

/**
 * What EVA would bring up first, derived from workspace state — never a
 * model call. The chat is where the real suggestion happens; this card only
 * points at the most useful conversation to start.
 */
function ProfileCard({ business }: { business: Business }) {
  const { t } = useI18n()
  const missing = missingQuestions(business).length
  const answered = PROFILE_QUESTION_TOTAL - missing
  const percent = Math.round((answered / PROFILE_QUESTION_TOTAL) * 100)

  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-foreground">
        {t('overview.businessProfile')}
      </h2>
      <div
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={t('overview.businessProfile')}
        className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted"
      >
        <div className="h-full rounded-full bg-eva-progress" style={{ width: `${percent}%` }} />
      </div>
      <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">
        {missing > 0
          ? t('overview.profileNote', { count: missing })
          : t('overview.profileComplete')}
      </p>
      {missing > 0 ? (
        <Button asChild variant="outline" size="sm" className="mt-4">
          <Link to={ROUTES.business}>{t('overview.finishProfile')}</Link>
        </Button>
      ) : null}
    </section>
  )
}

function CreativeThumbnail({ creative }: { creative: Creative }) {
  const [url, setUrl] = useState<string | null>(null)
  const path = creative.render?.storagePath ?? null

  useEffect(() => {
    if (!path) return
    let cancelled = false
    getAssetUrl(path)
      .then((next) => {
        if (!cancelled) setUrl(next)
      })
      .catch(() => {
        // The neutral tile stands in; the link still works.
      })
    return () => {
      cancelled = true
    }
  }, [path])

  return (
    <div className="aspect-square bg-muted">
      {url ? <img src={url} alt="" className="size-full object-cover" /> : null}
    </div>
  )
}
