import { describe, expect, it } from 'vitest'

import type { Business } from '@/types'
import { acceptBrain, emptyBusiness } from './brain'
import { mergeWebsiteAnalysis } from '../../../functions/src/business/brain/merge'
import type { MergeContext } from '../../../functions/src/business/brain/merge'
import type { StoredBusiness } from '../../../functions/src/lib/business.types'
import type { WebsiteAnalysis } from '../../../functions/src/business/brain/validate'

/**
 * The seam nobody else tests.
 *
 * Acceptance is written by the browser (`acceptBrain`) and honoured by a Cloud
 * Function (`mergeWebsiteAnalysis`). Each side has thorough tests of its own,
 * and both would keep passing if they quietly stopped agreeing about what an
 * accepted claim looks like — the owner would press "Looks good", the next
 * analysis would overwrite everything, and nothing would go red.
 *
 * So this file runs the real client function and feeds its real output to the
 * real merge, across the two type mirrors. It is the owner's journey with the
 * network taken out:
 *
 *   analyse -> accept -> re-analyse -> edit -> re-analyse
 */

const NOW = 1_800_000_000_000

/** What the first analysis left behind, before the owner had seen it. */
function discoveredBrain(): Business {
  return {
    id: 'biz_1',
    ...(emptyBusiness('owner_1', { name: 'Warung Mak Cik' }, 1) as Omit<Business, 'id'>),
    name: 'Warung Mak Cik',
    identity: {
      legalName: null,
      tagline: 'Home-style Malay food',
      description: 'A neighbourhood warung in Bangsar.',
      category: 'Restaurant',
      subIndustry: null,
      businessType: null,
      foundedYear: null,
    },
    contact: {
      email: null,
      phone: '0322011188',
      whatsapp: null,
      website: 'https://warungmakcik.com',
      socialProfiles: [],
    },
    provenance: {
      name: mark('website', 0.9),
      'identity.tagline': mark('website', 0.7),
      'identity.description': mark('website', 0.8),
      'contact.phone': mark('website', 0.8),
    },
    products: [
      {
        id: 'p_nasi_lemak_0',
        name: 'Nasi Lemak',
        description: null,
        priceMinor: 800,
        currency: 'MYR',
        category: null,
        imageUrl: null,
        isSignature: false,
        attributes: [],
        source: 'website',
        sourceRef: 'https://warungmakcik.com/menu',
        confidence: 0.7,
        confirmed: false,
      },
    ],
    audience: {
      value: {
        summary: 'Office workers nearby',
        segments: [],
        customerTypes: ['Office workers'],
        demographics: [],
        useCases: [],
        needs: [],
        preferences: [],
      },
      ...mark('inferred', 0.5),
    },
  }
}

function mark(source: 'website' | 'inferred', confidence: number) {
  return {
    source,
    sourceRef: 'https://warungmakcik.com',
    confidence,
    confirmed: false,
    discoveredAt: 1,
    confirmedAt: null,
  } as const
}

/** A second read of the same site, disagreeing about everything it can. */
function secondAnalysis(): WebsiteAnalysis {
  return {
    identity: {
      businessName: 'Warung Mak Cik Sdn Bhd',
      legalName: null,
      tagline: 'Malay comfort food',
      description: 'Warung in Bangsar serving nasi campur.',
      category: 'Cafe',
      subIndustry: 'Malay cuisine',
      businessType: 'Dine-in',
      industry: 'food_and_beverage',
    },
    location: {
      addressLine1: '12 Jalan Telawi',
      city: 'Kuala Lumpur',
      state: 'Wilayah Persekutuan',
      postcode: '59100',
      countryCode: 'MY',
      serviceArea: null,
      openingHours: 'Daily 8am - 9pm',
    },
    contact: {
      email: 'hello@warungmakcik.com',
      phone: '0399998888',
      whatsapp: null,
      socialProfiles: [],
    },
    products: [
      { name: 'Nasi Lemak', description: null, price: 12, category: null, isSignature: false, attributes: [], currency: 'MYR', sourceUrl: 'https://warungmakcik.com/menu', confidence: 0.7 },
    ],
    audience: {
      summary: 'Tourists passing through',
      customerTypes: ['Tourists'],
      demographics: [],
      useCases: [],
      needs: [],
      preferences: [],
      segments: [],
      sourceUrl: null,
      confidence: 0.5,
    },
    brand: {
      voice: 'Warm',
      personalityTraits: ['Homely'],
      visualStyle: null,
      keyMessages: [],
      valuePropositions: [],
      sourceUrl: null,
      confidence: 0.5,
    },
    marketing: {
      positioning: 'Affordable home cooking',
      valueProposition: null,
      differentiators: [],
      activeChannels: [],
      promotions: [],
      callsToAction: [],
      themes: [],
      emphasizedProducts: [],
      sourceUrl: null,
      confidence: 0.7,
    },
    operations: {
      openingHours: 'Daily 8am - 9pm',
      orderingMethods: [],
      deliveryPlatforms: [],
      reservations: null,
      notes: [],
      sourceUrl: null,
      confidence: 0.7,
    },
    fieldSources: [
      { field: 'name', sourceUrl: 'https://warungmakcik.com', confidence: 0.95 },
      { field: 'contact.phone', sourceUrl: 'https://warungmakcik.com', confidence: 0.95 },
    ],
    unknowns: [],
    summary: 'A Malay warung in Bangsar.',
  } as WebsiteAnalysis
}

const CONTEXT: MergeContext = {
  websiteUrl: 'https://warungmakcik.com',
  pagesAnalysed: 4,
  now: NOW + 60_000,
}

/** Applies a client-side acceptance to the document the backend will read. */
function stored(business: Business): StoredBusiness {
  return business as unknown as StoredBusiness
}

describe('accepting the Brain, then re-analysing the website', () => {
  const reviewed = discoveredBrain()
  const acceptance = acceptBrain(reviewed, NOW)
  const accepted = { ...reviewed, ...acceptance }
  const patch = mergeWebsiteAnalysis(stored(accepted), secondAnalysis(), CONTEXT)

  /**
   * The control. Without this, every assertion below could pass because the
   * second analysis happens to agree — and the test would prove nothing.
   */
  it('would have been overwritten had the owner not accepted', () => {
    const unaccepted = mergeWebsiteAnalysis(stored(reviewed), secondAnalysis(), CONTEXT)

    expect(unaccepted.name).toBe('Warung Mak Cik Sdn Bhd')
    expect(unaccepted.contact?.phone).toBe('0399998888')
    expect(unaccepted.audience?.value.summary).toBe('Tourists passing through')
    expect(unaccepted.products?.[0]?.priceMinor).toBe(1200)
  })

  it('protects every fact the owner accepted, even at higher confidence', () => {
    // The second read is more confident (0.95 vs 0.9) and still loses: an
    // accepted claim is not a confidence contest.
    expect(patch.name).toBe('Warung Mak Cik')
    expect(patch.identity?.tagline).toBe('Home-style Malay food')
    expect(patch.contact?.phone).toBe('0322011188')
  })

  it('protects an accepted inference and an accepted product', () => {
    expect(patch.audience?.value.summary).toBe('Office workers nearby')
    expect(patch.products?.[0]?.priceMinor).toBe(800)
  })

  it('does not restamp accepted values as though the owner had typed them', () => {
    expect(patch.provenance?.name?.source).toBe('website')
    expect(patch.audience?.source).toBe('inferred')
  })

  it('still learns what was unknown at the time of acceptance', () => {
    expect(patch.location?.city).toBe('Kuala Lumpur')
    expect(patch.contact?.email).toBe('hello@warungmakcik.com')
    expect(patch.identity?.subIndustry).toBe('Malay cuisine')
    expect(patch.brand?.value.voice).toBe('Warm')
  })

  /**
   * Step 5 of the journey. A manual correction after acceptance is the
   * strongest claim in the Brain and must outlive every later analysis.
   */
  it('protects a field the owner edited by hand after accepting', () => {
    const edited: Business = {
      ...accepted,
      ...(patch as unknown as Partial<Business>),
      identity: { ...accepted.identity, subIndustry: 'Nasi campur' },
      provenance: {
        ...accepted.provenance,
        'identity.subIndustry': {
          source: 'user',
          sourceRef: null,
          confidence: 1,
          confirmed: true,
          discoveredAt: NOW + 120_000,
          confirmedAt: NOW + 120_000,
        },
      },
    }

    const third = mergeWebsiteAnalysis(stored(edited), secondAnalysis(), {
      ...CONTEXT,
      now: NOW + 200_000,
    })

    expect(third.identity?.subIndustry).toBe('Nasi campur')
    expect(third.provenance?.['identity.subIndustry']?.source).toBe('user')
  })
})
