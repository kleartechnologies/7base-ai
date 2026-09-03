import { useState } from 'react'
import type { Audience, BrandProfile, Business, MarketingProfile, Product } from '@/types'
import type { BusinessFacts } from '@/services/business/brain'
import {
  saveBrainSection,
  saveBusinessFacts,
  saveProducts,
} from '@/services/business/business.service'
import { toUserMessage } from '@/lib/firebase/errors'
import { AudienceSection } from './components/AudienceSection'
import { BrandSection } from './components/BrandSection'
import { BusinessSection } from './components/BusinessSection'
import { OfferSection } from './components/OfferSection'

/**
 * The Business Brain, rendered once and used twice.
 *
 * Onboarding's review step and the Business tab are the same component over
 * the same documents — there is no separate profile to keep in step. Every
 * save here stamps the change as the owner's, which is what gives it authority
 * over anything a future analysis discovers.
 */
export function BusinessBrain({
  business,
  onSaved,
}: {
  business: Business
  onSaved?: () => void | Promise<void>
}) {
  const [error, setError] = useState<string | null>(null)

  async function save(action: () => Promise<void>) {
    setError(null)
    try {
      await action()
      await onSaved?.()
    } catch (caught) {
      setError(toUserMessage(caught, 'Could not save your changes. Please try again.'))
      throw caught
    }
  }

  return (
    <div className="space-y-4">
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <BusinessSection
        business={business}
        onSave={(facts: BusinessFacts) => save(() => saveBusinessFacts(business, facts))}
      />
      <OfferSection
        business={business}
        onSave={(products: Product[]) => save(() => saveProducts(business.id, products))}
      />
      <BrandSection
        business={business}
        onSave={(brand: BrandProfile, marketing: MarketingProfile) =>
          save(async () => {
            await saveBrainSection(business.id, 'brand', brand)
            await saveBrainSection(business.id, 'marketing', marketing)
          })
        }
      />
      <AudienceSection
        business={business}
        onSave={(audience: Audience) =>
          save(() => saveBrainSection(business.id, 'audience', audience))
        }
      />
    </div>
  )
}
