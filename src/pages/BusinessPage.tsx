import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Globe, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { BusinessBrain } from '@/features/business/BusinessBrain'
import { CompletionCard } from '@/features/business/components/CompletionCard'
import { BrandIdentityTab } from '@/features/business/brand/BrandIdentityTab'
import { ROUTES } from '@/app/routes/paths'
import { useAuth } from '@/hooks/useAuth'
import { useI18n } from '@/hooks/useI18n'
import { observeBusiness } from '@/services/business/business.service'
import { cn } from '@/lib/utils'
import type { Business } from '@/types'

/**
 * The Business Brain's permanent home.
 *
 * Exactly the same sections, over exactly the same documents, as the
 * onboarding review — there is no second copy of the business profile. What
 * the owner edits here is stamped as theirs and outranks anything MARKA
 * discovers later.
 */
export default function BusinessPage() {
  const { t, language } = useI18n()
  const { user, business: initial, refresh } = useAuth()
  const businessId = initial?.id ?? null

  // Which face of the page is showing is the route's call: /business is the
  // Profile, /business/brand the Brand Identity — one page, two tabs, no new
  // sidebar item.
  const location = useLocation()
  const navigate = useNavigate()
  const onBrandTab = location.pathname === ROUTES.businessBrand

  // Leaving the brand tab mid-edit asks first. A ref, not state — the guard
  // only reads it at the moment of switching.
  const brandDirtyRef = useRef(false)
  const handleBrandDirty = useCallback((dirty: boolean) => {
    brandDirtyRef.current = dirty
  }, [])

  const switchTab = (path: string) => {
    if (location.pathname === path) return
    if (onBrandTab && brandDirtyRef.current && !window.confirm(t('brand.unsavedGuard'))) return
    navigate(path)
  }

  // Live, because the backend writes into this document too. The snapshot is
  // tagged with the id it belongs to so a business switch never shows the
  // previous one's data for a frame.
  const [live, setLive] = useState<{ id: string; business: Business } | null>(null)

  useEffect(() => {
    if (!businessId) return
    return observeBusiness(businessId, (next) => {
      if (next) setLive({ id: businessId, business: next })
    })
  }, [businessId])

  const business = live && live.id === businessId ? live.business : initial

  if (!business) {
    return (
      <div className="relative h-full overflow-y-auto">
        <div className="mx-auto w-full max-w-lg px-8 py-20 text-center">
          <Globe className="mx-auto size-5 text-muted-foreground/60" aria-hidden />
          <h1 className="mt-4 text-[18px] font-semibold text-foreground">
            {t('business.emptyTitle')}
          </h1>
          <p className="mx-auto mt-2 max-w-sm text-[15px] leading-relaxed text-muted-foreground">
            {t('business.emptyBody')}
          </p>
          <Button asChild size="lg" className="mt-6">
            <Link to={ROUTES.onboarding}>{t('business.setUp')}</Link>
          </Button>
        </div>
      </div>
    )
  }

  const website = business.contact.website
  const analysedAt = business.discovery.completedAt

  return (
    // `relative` makes this scroller the containing block for absolutely
    // positioned descendants — the screen-reader-only file input in the logo
    // section among them. Without it their containing block is the document,
    // they escape the shell's overflow clip, and a tall page grows the
    // document behind the shell: the wheel chains to it once the inner
    // scroller ends and the whole shell drifts up.
    <div className="relative h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-2xl px-8 py-12">
        <header className="mb-8">
          <h1 className="text-[22px] font-semibold tracking-[-0.015em] text-foreground">
            {business.name}
          </h1>
          <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">
            {t('business.pageIntro')}
          </p>

          {website && !onBrandTab ? (
            <div className="mt-5 flex flex-wrap items-center gap-3 text-[13px] text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <Globe className="size-3.5" aria-hidden />
                {website}
              </span>
              {analysedAt ? (
                <span>
                  {t('business.lastRead', {
                    date: new Date(analysedAt).toLocaleDateString(
                      language === 'ms' ? 'ms-MY' : 'en-MY',
                      { day: 'numeric', month: 'short', year: 'numeric' },
                    ),
                  })}
                </span>
              ) : null}
              <Button asChild variant="ghost" size="sm">
                <Link to={ROUTES.onboarding}>
                  <RefreshCw aria-hidden />
                  {t('business.rereadWebsite')}
                </Link>
              </Button>
            </div>
          ) : null}
        </header>

        <nav
          role="tablist"
          aria-label={business.name}
          className="mb-6 flex items-center gap-1 border-b border-border"
        >
          <TabButton
            selected={!onBrandTab}
            label={t('business.tabProfile')}
            onClick={() => switchTab(ROUTES.business)}
          />
          <TabButton
            selected={onBrandTab}
            label={t('brand.tabTitle')}
            onClick={() => switchTab(ROUTES.businessBrand)}
          />
        </nav>

        {onBrandTab && user ? (
          <BrandIdentityTab
            business={business}
            ownerId={user.uid}
            onSaved={refresh}
            onDirtyChange={handleBrandDirty}
          />
        ) : (
          <>
            <div className="mb-4">
              {/* "Help EVA finish your profile" — shown only while EVA still
                  has questions worth asking. The persistent home of profile
                  completion, so skipping it during onboarding costs nothing. */}
              <CompletionCard business={business} onSaved={refresh} />
            </div>

            {/* onSaved keeps the provider's one-shot copy in step with edits
                made here, so the rest of the app (chat context, guards) sees
                them too. */}
            <BusinessBrain business={business} onSaved={refresh} />
          </>
        )}
      </div>
    </div>
  )
}

function TabButton({
  selected,
  label,
  onClick,
}: {
  selected: boolean
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      onClick={onClick}
      className={cn(
        '-mb-px border-b-2 px-3 py-2.5 text-[13.5px] transition-colors focus-visible:outline-2 focus-visible:outline-ring',
        selected
          ? 'border-foreground font-medium text-foreground'
          : 'border-transparent text-muted-foreground hover:text-foreground',
      )}
    >
      {label}
    </button>
  )
}
