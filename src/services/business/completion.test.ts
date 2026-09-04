import { describe, expect, it } from 'vitest'

import type { Business, ConnectedSource, Discovered, Product } from '@/types'
import { emptyBusiness, provenanceForEdits, userProvenance } from './brain'
import {
  applyAnswer,
  completionIntro,
  latestDiscoverySource,
  missingQuestions,
  ORDERING_CHOICES,
} from './completion'

/**
 * The deterministic half of EVA Business Profile Completion.
 *
 * Two properties carry the whole feature: EVA never asks what she already
 * knows, and every answer becomes an owner-authored fact — never an invented
 * one. If either breaks, the flow is worse than not existing: it would nag
 * owners about known facts, or quietly fabricate unknowns.
 */

const NOW = 1_800_000_000_000

function business(over: Partial<Business> = {}): Business {
  return {
    id: 'biz_1',
    ...(emptyBusiness('owner_1', { name: 'Nasi Arab AlShams' }, 1) as Omit<Business, 'id'>),
    ...over,
  }
}

function discovered<T>(value: T, source: 'website' | 'facebook' | 'inferred'): Discovered<T> {
  return {
    value,
    source,
    sourceRef: null,
    confidence: 0.7,
    confirmed: false,
    discoveredAt: 1,
    confirmedAt: null,
  }
}

function product(over: Partial<Product> & { id: string; name: string }): Product {
  return {
    description: null,
    priceMinor: null,
    currency: 'MYR',
    category: null,
    imageUrl: null,
    isSignature: false,
    attributes: [],
    source: 'facebook',
    sourceRef: null,
    confidence: 0.7,
    confirmed: false,
    ...over,
  }
}

function connectedSource(
  kind: 'website' | 'facebook' | 'instagram',
  lastSyncedAt: number,
): ConnectedSource {
  return { id: kind, kind, label: kind, reference: `https://example.com/${kind}`, status: 'connected', lastSyncedAt }
}

const operationsValue = {
  openingHours: null,
  orderingMethods: [],
  deliveryPlatforms: [],
  reservations: null,
  notes: [],
}

const marketingValue = {
  positioning: null,
  valueProposition: null,
  differentiators: [],
  competitors: [],
  activeChannels: [],
  pastActivity: null,
  promotions: [],
  callsToAction: [],
  themes: [],
  emphasizedProducts: [],
}

const audienceValue = {
  summary: null,
  segments: [],
  customerTypes: [],
  demographics: [],
  useCases: [],
  needs: [],
  preferences: [],
}

describe('missingQuestions', () => {
  it('asks the high-value questions for a sparse discovery (the §27 Facebook case)', () => {
    // Facebook gave name, type and location — nothing else.
    const sparse = business({
      identity: {
        legalName: null,
        tagline: null,
        description: null,
        category: 'Middle Eastern restaurant',
        subIndustry: null,
        businessType: 'restaurant',
        foundedYear: null,
      },
      location: {
        addressLine1: null,
        addressLine2: null,
        city: 'Banting',
        state: 'Selangor',
        postcode: null,
        countryCode: 'MY',
        openingHours: null,
        serviceArea: null,
      },
    })

    expect(missingQuestions(sparse).map((question) => question.id)).toEqual([
      'best_sellers',
      'opening_hours',
      'ordering_methods',
      'differentiator',
      'customers',
    ])
  })

  it('never asks more than five questions, even with everything missing', () => {
    expect(missingQuestions(business()).length).toBeLessThanOrEqual(5)
  })

  it('never asks what EVA already knows', () => {
    const known = business({
      identity: { ...business().identity, description: 'Yemeni rice dishes' },
      location: { ...business().location, openingHours: 'Daily 11–10' },
      products: [product({ id: 'p1', name: 'Lamb mandi' })],
      operations: discovered({ ...operationsValue, orderingMethods: ['Dine-in'] }, 'facebook'),
      marketing: discovered({ ...marketingValue, differentiators: ['Charcoal-fired'] }, 'facebook'),
      audience: discovered({ ...audienceValue, summary: 'Families' }, 'inferred'),
    })

    expect(missingQuestions(known)).toEqual([])
  })

  it('treats operations-held opening hours as known too', () => {
    const withHours = business({
      operations: discovered({ ...operationsValue, openingHours: 'Daily 11–10' }, 'website'),
    })
    expect(missingQuestions(withHours).map((question) => question.id)).not.toContain(
      'opening_hours',
    )
  })

  it('counts emphasized products as an answer to "best known for"', () => {
    const emphasized = business({
      marketing: discovered(
        { ...marketingValue, emphasizedProducts: ['Lamb mandi'], valueProposition: 'x' },
        'website',
      ),
    })
    const ids = missingQuestions(emphasized).map((question) => question.id)
    expect(ids).not.toContain('best_sellers')
    expect(ids).not.toContain('differentiator')
  })

  it('depends only on what the Brain holds, not where it came from', () => {
    // The same gaps produce the same questions whether the Brain came from a
    // website, a Facebook Page, an Instagram profile, or no source at all.
    const kinds: ConnectedSource[][] = [
      [],
      [connectedSource('website', 1)],
      [connectedSource('facebook', 1)],
      [connectedSource('instagram', 1)],
    ]
    const expected = missingQuestions(business()).map((question) => question.id)
    for (const sources of kinds) {
      expect(missingQuestions(business({ sources })).map((question) => question.id)).toEqual(
        expected,
      )
    }
  })

  it('asks for a description only when there is room left', () => {
    // Everything else known, description missing: now there is room to ask.
    const almostComplete = business({
      location: { ...business().location, openingHours: 'Daily' },
      products: [product({ id: 'p1', name: 'Lamb mandi' })],
      operations: discovered({ ...operationsValue, orderingMethods: ['Dine-in'] }, 'website'),
      marketing: discovered({ ...marketingValue, differentiators: ['Only mandi'] }, 'website'),
      audience: discovered({ ...audienceValue, summary: 'Families' }, 'inferred'),
    })
    expect(missingQuestions(almostComplete).map((question) => question.id)).toEqual(['description'])
  })
})

describe('applyAnswer — owner authority, no fake certainty', () => {
  it('turns best-seller lines into owner-authored signature products with nothing invented', () => {
    const write = applyAnswer(business(), 'best_sellers', 'Lamb mandi\nChicken kabsah, Arab tea', NOW)
    if (write?.kind !== 'products') throw new Error('expected a products write')

    expect(write.products.map((item) => item.name)).toEqual([
      'Lamb mandi',
      'Chicken kabsah',
      'Arab tea',
    ])
    for (const item of write.products) {
      expect(item).toMatchObject({
        source: 'user',
        confidence: 1,
        confirmed: true,
        confirmedAt: NOW,
        isSignature: true,
        // §12: the owner named the dish — EVA must not invent the rest.
        priceMinor: null,
        description: null,
      })
    }
  })

  it('marks an already-discovered product as signature instead of duplicating it', () => {
    const existing = product({ id: 'p1', name: 'Lamb Mandi!', priceMinor: 2500 })
    const write = applyAnswer(
      business({ products: [existing] }),
      'best_sellers',
      'lamb mandi',
      NOW,
    )
    if (write?.kind !== 'products') throw new Error('expected a products write')

    expect(write.products).toHaveLength(1)
    expect(write.products[0]).toMatchObject({
      id: 'p1',
      // The page's price survives; the owner vouched for the dish, not a new
      // entry — origin stays honest while gaining the owner's authority.
      priceMinor: 2500,
      source: 'facebook',
      isSignature: true,
      confirmed: true,
      confirmedAt: NOW,
    })
  })

  it('writes opening hours into the facts the provenance model already covers', () => {
    const base = business()
    const write = applyAnswer(base, 'opening_hours', 'Tue–Sun, 11am–10pm', NOW)
    if (write?.kind !== 'facts') throw new Error('expected a facts write')

    expect(write.facts.location.openingHours).toBe('Tue–Sun, 11am–10pm')
    // Through the real save path, exactly this field gains the owner's stamp.
    const provenance = provenanceForEdits(base, write.facts, NOW)
    expect(provenance['location.openingHours']).toEqual(userProvenance(NOW))
    expect(provenance['location.city']).toBeUndefined()
  })

  it('adds ordering methods without discarding what the section already held', () => {
    const base = business({
      operations: discovered({ ...operationsValue, deliveryPlatforms: ['GrabFood'] }, 'facebook'),
    })
    const write = applyAnswer(base, 'ordering_methods', ['Dine-in', 'Takeaway'], NOW)
    if (write?.kind !== 'section' || write.section !== 'operations') {
      throw new Error('expected an operations write')
    }
    expect(write.value.orderingMethods).toEqual(['Dine-in', 'Takeaway'])
    expect(write.value.deliveryPlatforms).toEqual(['GrabFood'])
  })

  it('appends a differentiator instead of erasing discovered ones', () => {
    const base = business({
      marketing: discovered({ ...marketingValue, promotions: ['Set lunch'] }, 'website'),
    })
    const write = applyAnswer(base, 'differentiator', 'Charcoal-fired mandi', NOW)
    if (write?.kind !== 'section' || write.section !== 'marketing') {
      throw new Error('expected a marketing write')
    }
    expect(write.value.differentiators).toEqual(['Charcoal-fired mandi'])
    expect(write.value.promotions).toEqual(['Set lunch'])
  })

  it('sets the audience summary while keeping the discovered reading', () => {
    const base = business({
      audience: discovered({ ...audienceValue, customerTypes: ['Families'] }, 'inferred'),
    })
    const write = applyAnswer(base, 'customers', 'Office workers at lunch', NOW)
    if (write?.kind !== 'section' || write.section !== 'audience') {
      throw new Error('expected an audience write')
    }
    expect(write.value.summary).toBe('Office workers at lunch')
    expect(write.value.customerTypes).toEqual(['Families'])
  })

  it('writes a description as plain owner facts', () => {
    const write = applyAnswer(business(), 'description', ' Yemeni rice dishes. ', NOW)
    if (write?.kind !== 'facts') throw new Error('expected a facts write')
    expect(write.facts.identity.description).toBe('Yemeni rice dishes.')
  })

  it('writes nothing for an empty answer — a skip is not a fact', () => {
    expect(applyAnswer(business(), 'best_sellers', '  \n , ', NOW)).toBeNull()
    expect(applyAnswer(business(), 'opening_hours', '   ', NOW)).toBeNull()
    expect(applyAnswer(business(), 'ordering_methods', [], NOW)).toBeNull()
    expect(applyAnswer(business(), 'differentiator', '', NOW)).toBeNull()
    expect(applyAnswer(business(), 'customers', '', NOW)).toBeNull()
    expect(applyAnswer(business(), 'description', '', NOW)).toBeNull()
  })
})

describe('source-aware framing', () => {
  it('names the analysed source, most recent first', () => {
    expect(latestDiscoverySource(business())).toBeNull()
    expect(
      latestDiscoverySource(
        business({ sources: [connectedSource('website', 1), connectedSource('facebook', 2)] }),
      ),
    ).toBe('facebook')
  })

  it('frames missing info as normal, in words matched to the source', () => {
    expect(completionIntro(business({ sources: [connectedSource('facebook', 1)] }))).toContain(
      'Facebook Page',
    )
    expect(completionIntro(business({ sources: [connectedSource('instagram', 1)] }))).toContain(
      'Instagram profile',
    )
    // No source (manual onboarding): an invitation, not an apology.
    expect(completionIntro(business())).toContain('EVA knows the basics')
  })
})

describe('choices stay in step with the operations vocabulary', () => {
  it('offers the ordering mix the Brain already models', () => {
    expect(ORDERING_CHOICES).toContain('Dine-in')
    expect(ORDERING_CHOICES).toContain('Takeaway')
    expect(ORDERING_CHOICES).toContain('Delivery')
  })
})
