import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Globe, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { BusinessBrain } from '@/features/business/BusinessBrain'
import { ROUTES } from '@/app/routes/paths'
import { useAuth } from '@/hooks/useAuth'
import { observeBusiness } from '@/services/business/business.service'
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
  const { business: initial } = useAuth()
  const businessId = initial?.id ?? null

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
      <div className="h-full overflow-y-auto">
        <div className="mx-auto w-full max-w-lg px-8 py-20 text-center">
          <Globe className="mx-auto size-5 text-muted-foreground/60" aria-hidden />
          <h1 className="mt-4 text-[18px] font-semibold text-foreground">
            MARKA doesn’t know your business yet
          </h1>
          <p className="mx-auto mt-2 max-w-sm text-[15px] leading-relaxed text-muted-foreground">
            Give MARKA your website and it will work out the rest.
          </p>
          <Button asChild size="lg" className="mt-6">
            <Link to={ROUTES.onboarding}>Set up my business</Link>
          </Button>
        </div>
      </div>
    )
  }

  const website = business.contact.website
  const analysedAt = business.discovery.completedAt

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-2xl px-8 py-12">
        <header className="mb-8">
          <h1 className="text-[22px] font-semibold tracking-[-0.015em] text-foreground">
            {business.name}
          </h1>
          <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">
            What MARKA knows about your business. Everything here is editable — your version always
            wins.
          </p>

          {website ? (
            <div className="mt-5 flex flex-wrap items-center gap-3 text-[13px] text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <Globe className="size-3.5" aria-hidden />
                {website}
              </span>
              {analysedAt ? (
                <span>
                  Last read{' '}
                  {new Date(analysedAt).toLocaleDateString('en-MY', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  })}
                </span>
              ) : null}
              <Button asChild variant="ghost" size="sm">
                <Link to={ROUTES.onboarding}>
                  <RefreshCw aria-hidden />
                  Re-read my website
                </Link>
              </Button>
            </div>
          ) : null}
        </header>

        <BusinessBrain business={business} />
      </div>
    </div>
  )
}
