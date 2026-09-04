import { describe, expect, it } from 'vitest'

import type { FieldProvenance, Product, StoredBusiness } from '../../lib/business.types'
import { mergeProducts, mergeSection, mergeWebsiteAnalysis, productKey, toMinorUnits } from './merge'
import type { MergeContext } from './merge'
import type { WebsiteAnalysis } from './validate'

/**
 * The scenario running under most of this file: MARKA read a website, the
 * owner corrected a few things on the review screen, and then the website was
 * re-analysed. Nothing the owner touched may move.
 */

const NOW = 1_800_000_000_000
const CONTEXT: MergeContext = {
  websiteUrl: 'https://warungmakcik.com',
  pagesAnalysed: 4,
  now: NOW,
}

function analysis(over: Partial<WebsiteAnalysis> = {}): WebsiteAnalysis {
  return {
    identity: {
      businessName: 'Warung Mak Cik',
      legalName: null,
      tagline: 'Home-style Malay food',
      description: 'A neighbourhood warung in Bangsar serving nasi campur.',
      category: 'Restaurant',
      subIndustry: 'Malay cuisine',
      businessType: 'Dine-in and takeaway',
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
      phone: '0322011188',
      whatsapp: null,
      socialProfiles: [
        { platform: 'facebook', handle: 'warungmakcik', url: 'https://facebook.com/warungmakcik' },
      ],
    },
    products: [],
    audience: {
      summary: 'Office workers nearby',
      customerTypes: ['Office workers'],
      demographics: [],
      useCases: ['Weekday lunch'],
      needs: [],
      preferences: [],
      segments: [],
      sourceUrl: 'https://warungmakcik.com/about',
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
      activeChannels: ['facebook'],
      promotions: ['Set lunch RM12'],
      callsToAction: ['Order on WhatsApp'],
      themes: [],
      emphasizedProducts: [],
      sourceUrl: null,
      confidence: 0.7,
    },
    operations: {
      openingHours: 'Daily 8am - 9pm',
      orderingMethods: ['Walk-in'],
      deliveryPlatforms: ['GrabFood'],
      reservations: null,
      notes: [],
      sourceUrl: null,
      confidence: 0.7,
    },
    fieldSources: [
      { field: 'name', sourceUrl: 'https://warungmakcik.com', confidence: 0.9 },
      { field: 'contact.phone', sourceUrl: 'https://warungmakcik.com/contact', confidence: 0.8 },
    ],
    unknowns: ['Whether they cater events'],
    summary: 'A Malay warung in Bangsar.',
    ...over,
  }
}

function business(over: Partial<StoredBusiness> = {}): StoredBusiness {
  return {
    ownerId: 'owner_1',
    name: 'Untitled business',
    industry: 'other',
    identity: {
      legalName: null,
      tagline: null,
      description: null,
      category: null,
      subIndustry: null,
      businessType: null,
      foundedYear: null,
    },
    contact: { email: null, phone: null, whatsapp: null, website: null, socialProfiles: [] },
    location: {
      addressLine1: null,
      addressLine2: null,
      city: null,
      state: null,
      postcode: null,
      countryCode: 'MY',
      openingHours: null,
      serviceArea: null,
    },
    products: [],
    audience: null,
    brand: null,
    marketing: null,
    operations: null,
    provenance: {},
    sources: [],
    discovery: {
      status: 'not_started',
      stage: null,
      lastRunAt: null,
      completedAt: null,
      sourceRef: null,
      pagesAnalysed: 0,
      error: null,
      errorCode: null,
      summary: null,
      unknowns: [],
    },
    brainVersion: 2,
    createdAt: 1,
    updatedAt: 1,
    ...over,
  }
}

const confirmedBy = (source: FieldProvenance['source']): FieldProvenance => ({
  source,
  sourceRef: null,
  confidence: 1,
  confirmed: true,
  discoveredAt: 10,
})

function product(over: Partial<Product> = {}): Product {
  return {
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
    ...over,
  }
}

describe('mergeWebsiteAnalysis on an empty Brain', () => {
  const patch = mergeWebsiteAnalysis(business(), analysis(), CONTEXT)

  it('fills the facts the website stated', () => {
    expect(patch.name).toBe('Warung Mak Cik')
    expect(patch.identity?.tagline).toBe('Home-style Malay food')
    expect(patch.location?.city).toBe('Kuala Lumpur')
    expect(patch.contact?.phone).toBe('0322011188')
  })

  it('records where each fact came from, not just the fact', () => {
    expect(patch.provenance?.name).toMatchObject({
      source: 'website',
      sourceRef: 'https://warungmakcik.com',
      confidence: 0.9,
      confirmed: false,
      discoveredAt: NOW,
    })
    expect(patch.provenance?.['contact.phone']?.sourceRef).toBe(
      'https://warungmakcik.com/contact',
    )
  })

  it('falls back to the analysed URL when the model names no page', () => {
    expect(patch.provenance?.['identity.tagline']?.sourceRef).toBe('https://warungmakcik.com')
  })

  it('labels what MARKA worked out as inference and what the page stated as website', () => {
    expect(patch.audience?.source).toBe('inferred')
    expect(patch.brand?.source).toBe('inferred')
    expect(patch.marketing?.source).toBe('website')
    expect(patch.operations?.source).toBe('website')
  })

  it('never marks its own findings as confirmed', () => {
    expect(patch.audience?.confirmed).toBe(false)
    for (const entry of Object.values(patch.provenance ?? {})) {
      expect(entry.confirmed).toBe(false)
    }
  })

  it('stores the analysed URL as the website rather than treating it as a discovery', () => {
    expect(patch.contact?.website).toBe('https://warungmakcik.com')
    expect(patch.provenance?.['contact.website']).toBeUndefined()
  })

  it('registers the website as a connected source', () => {
    expect(patch.sources).toEqual([
      {
        id: 'website',
        kind: 'website',
        label: 'Website',
        reference: 'https://warungmakcik.com',
        status: 'connected',
        lastSyncedAt: NOW,
      },
    ])
  })

  it('leaves out sections the website said nothing about', () => {
    const quiet = mergeWebsiteAnalysis(
      business(),
      analysis({
        operations: {
          openingHours: null,
          orderingMethods: [],
          deliveryPlatforms: [],
          reservations: null,
          notes: [],
          sourceUrl: null,
          confidence: 0.5,
        },
      }),
      CONTEXT,
    )
    expect(quiet.operations).toBeNull()
  })
})

describe('mergeWebsiteAnalysis over a Brain the owner has corrected', () => {
  const corrected = business({
    name: "Mak Cik's Kitchen",
    identity: {
      legalName: null,
      tagline: 'Kampung food, city prices',
      description: null,
      category: null,
      subIndustry: null,
      businessType: null,
      foundedYear: 1998,
    },
    contact: {
      email: null,
      phone: '0139998888',
      whatsapp: null,
      website: 'https://warungmakcik.com',
      socialProfiles: [],
    },
    provenance: {
      name: confirmedBy('user'),
      'identity.tagline': confirmedBy('user'),
      'contact.phone': confirmedBy('user'),
    },
    brand: {
      value: {
        voice: 'Blunt and funny',
        personalityTraits: [],
        colors: [],
        logoUrl: null,
        fontFamily: null,
        visualStyle: null,
        keyMessages: [],
        valuePropositions: [],
      },
      source: 'user',
      sourceRef: null,
      confidence: 1,
      confirmed: true,
      discoveredAt: 10,
    },
  })

  const patch = mergeWebsiteAnalysis(corrected, analysis(), CONTEXT)

  it('keeps every fact the owner confirmed', () => {
    expect(patch.name).toBe("Mak Cik's Kitchen")
    expect(patch.identity?.tagline).toBe('Kampung food, city prices')
    expect(patch.contact?.phone).toBe('0139998888')
  })

  it('leaves the provenance of a confirmed fact untouched', () => {
    expect(patch.provenance?.name).toEqual(confirmedBy('user'))
  })

  it('keeps a brand voice the owner rewrote', () => {
    expect(patch.brand?.value.voice).toBe('Blunt and funny')
    expect(patch.brand?.confirmed).toBe(true)
  })

  it('still refreshes the fields the owner never touched', () => {
    expect(patch.identity?.description).toBe(
      'A neighbourhood warung in Bangsar serving nasi campur.',
    )
    expect(patch.location?.city).toBe('Kuala Lumpur')
    expect(patch.provenance?.['location.city']?.source).toBe('website')
  })

  it('preserves fields the website has no opinion on', () => {
    expect(patch.identity?.foundedYear).toBe(1998)
  })
})

describe('mergeWebsiteAnalysis run twice', () => {
  it('replaces a stale website reading with the current one', () => {
    const first = mergeWebsiteAnalysis(business(), analysis(), CONTEXT)
    const stored = business({ ...first } as Partial<StoredBusiness>)

    const second = mergeWebsiteAnalysis(
      stored,
      analysis({
        identity: { ...analysis().identity, tagline: 'Now open for breakfast' },
      }),
      { ...CONTEXT, now: NOW + 1000 },
    )

    expect(second.identity?.tagline).toBe('Now open for breakfast')
    expect(second.provenance?.['identity.tagline']?.discoveredAt).toBe(NOW + 1000)
  })

  it('does not accumulate duplicate website sources', () => {
    const first = mergeWebsiteAnalysis(business(), analysis(), CONTEXT)
    const second = mergeWebsiteAnalysis(
      business({ sources: first.sources }),
      analysis(),
      CONTEXT,
    )
    expect(second.sources?.filter((source) => source.id === 'website')).toHaveLength(1)
  })
})

describe('mergeSection', () => {
  const stored = {
    value: 'Friendly',
    source: 'inferred' as const,
    sourceRef: null,
    confidence: 0.5,
    confirmed: false,
    discoveredAt: 1,
  }

  it('keeps what is stored when the new analysis found nothing', () => {
    expect(mergeSection(stored, null, 'website', null, 0.9, NOW)).toBe(stored)
  })

  it('does not revert a confirmed section to a fresh guess', () => {
    const confirmed = { ...stored, source: 'user' as const, confirmed: true, confidence: 1 }
    expect(mergeSection(confirmed, 'Playful', 'inferred', null, 0.9, NOW)).toBe(confirmed)
  })

  it('accepts a guess where nothing was stored at all', () => {
    expect(mergeSection(null, 'Playful', 'inferred', 'https://x.test', 0.4, NOW)).toEqual({
      value: 'Playful',
      source: 'inferred',
      sourceRef: 'https://x.test',
      confidence: 0.4,
      confirmed: false,
      confirmedAt: null,
      discoveredAt: NOW,
    })
  })
})

describe('mergeProducts', () => {
  it('adds what the menu lists, priced in sen', () => {
    const merged = mergeProducts(
      [],
      analysis({
        products: [
          {
            name: 'Nasi Lemak Ayam',
            description: 'With fried chicken',
            price: 12.9,
            currency: 'MYR',
            category: 'Mains',
            isSignature: true,
            attributes: ['spicy'],
            sourceUrl: 'https://warungmakcik.com/menu',
            confidence: 0.8,
          },
        ],
      }),
      CONTEXT,
    )

    expect(merged).toHaveLength(1)
    expect(merged[0]).toMatchObject({
      name: 'Nasi Lemak Ayam',
      priceMinor: 1290,
      currency: 'MYR',
      isSignature: true,
      source: 'website',
      confirmed: false,
    })
  })

  it('leaves a confirmed item exactly as the owner left it', () => {
    const owned = product({ name: 'Nasi Lemak', priceMinor: 950, confirmed: true, source: 'user' })
    const merged = mergeProducts(
      [owned],
      analysis({
        products: [
          {
            name: 'Nasi Lemak',
            description: 'Website copy',
            price: 8,
            currency: 'MYR',
            category: null,
            isSignature: false,
            attributes: [],
            sourceUrl: null,
            confidence: 0.9,
          },
        ],
      }),
      CONTEXT,
    )

    expect(merged).toEqual([owned])
  })

  it('matches an existing item by name so re-analysis updates rather than duplicates', () => {
    const existing = product({ id: 'p_keeps_this_id', name: 'Nasi  Lemak!' })
    const merged = mergeProducts(
      [existing],
      analysis({
        products: [
          {
            name: 'nasi lemak',
            description: null,
            price: 9.5,
            currency: 'MYR',
            category: null,
            isSignature: false,
            attributes: [],
            sourceUrl: null,
            confidence: 0.8,
          },
        ],
      }),
      CONTEXT,
    )

    expect(merged).toHaveLength(1)
    expect(merged[0]).toMatchObject({ id: 'p_keeps_this_id', priceMinor: 950 })
  })

  it('drops an unconfirmed item the website no longer lists', () => {
    const merged = mergeProducts([product({ name: 'Discontinued Laksa' })], analysis(), CONTEXT)
    expect(merged).toEqual([])
  })

  it('keeps an owner-entered item the website never listed', () => {
    const owned = product({ id: 'p_secret', name: 'Off-menu Rendang', source: 'user' })
    const merged = mergeProducts([owned], analysis(), CONTEXT)
    expect(merged).toEqual([owned])
  })

  it('carries over an image the website analysis cannot supply', () => {
    const existing = product({ name: 'Nasi Lemak', imageUrl: 'https://cdn.test/nl.jpg' })
    const merged = mergeProducts(
      [existing],
      analysis({
        products: [
          {
            name: 'Nasi Lemak',
            description: null,
            price: 8,
            currency: null,
            category: null,
            isSignature: false,
            attributes: [],
            sourceUrl: null,
            confidence: 0.8,
          },
        ],
      }),
      CONTEXT,
    )
    expect(merged[0]).toMatchObject({ imageUrl: 'https://cdn.test/nl.jpg', currency: 'MYR' })
  })
})

describe('toMinorUnits', () => {
  it('converts ringgit to sen without float drift', () => {
    expect(toMinorUnits(12.9)).toBe(1290)
    expect(toMinorUnits(0.1)).toBe(10)
    expect(toMinorUnits(19.99)).toBe(1999)
  })

  it('treats an unknown price as unknown rather than free', () => {
    expect(toMinorUnits(null)).toBeNull()
    expect(toMinorUnits(Number.NaN)).toBeNull()
    expect(toMinorUnits(Number.POSITIVE_INFINITY)).toBeNull()
  })
})

describe('productKey', () => {
  it('matches the same dish written slightly differently', () => {
    expect(productKey('Nasi Lemak')).toBe(productKey('  nasi   lemak  '))
    expect(productKey('Teh Tarik (Ais)')).toBe(productKey('teh tarik ais'))
  })

  it('keeps genuinely different dishes apart', () => {
    expect(productKey('Nasi Lemak Ayam')).not.toBe(productKey('Nasi Lemak Sotong'))
  })
})

/**
 * The full owner journey, at the layer that decides who wins.
 *
 * MARKA analyses the site, the owner reads the Business Brain and presses
 * "Looks good", and the site is analysed again later — a new page, a scheduled
 * refresh, the owner pasting the URL a second time. What the owner accepted
 * must survive that, or their review was theatre.
 *
 * Acceptance is written by `acceptBrain` on the client: it keeps the original
 * `source` and adds `confirmed: true`. So the accepted claims below carry
 * `source: 'website'` and `source: 'inferred'` deliberately — this file is
 * checking that `confirmed` alone is enough to protect them, without any
 * pretence that the owner typed the values.
 */
describe('re-analysis after the owner accepted the Brain', () => {
  /** What "Looks good" leaves behind: origin intact, confirmed added. */
  const accepted = (source: FieldProvenance['source'], confidence: number): FieldProvenance => ({
    source,
    sourceRef: 'https://warungmakcik.com',
    confidence,
    confirmed: true,
    discoveredAt: 10,
    confirmedAt: 20,
  })

  const reviewed = business({
    name: 'Warung Mak Cik Bangsar',
    identity: {
      legalName: null,
      tagline: 'Masakan rumah',
      description: null,
      category: null,
      subIndustry: null,
      businessType: null,
      foundedYear: null,
    },
    contact: { email: null, phone: '0311112222', whatsapp: null, website: null, socialProfiles: [] },
    provenance: {
      name: accepted('website', 0.9),
      'identity.tagline': accepted('website', 0.7),
      'contact.phone': accepted('website', 0.8),
    },
    audience: {
      value: {
        summary: 'Regulars from the flats behind the shop',
        segments: [],
        customerTypes: ['Regulars'],
        demographics: [],
        useCases: [],
        needs: [],
        preferences: [],
      },
      ...accepted('inferred', 0.5),
    },
    products: [product({ confirmed: true, confirmedAt: 20, priceMinor: 950 })],
  })

  const patch = mergeWebsiteAnalysis(reviewed, analysis(), CONTEXT)

  it('keeps an accepted website fact even though the site now says otherwise', () => {
    // The fresh analysis says "Warung Mak Cik"; the owner accepted the longer name.
    expect(patch.name).toBe('Warung Mak Cik Bangsar')
    expect(patch.identity?.tagline).toBe('Masakan rumah')
    expect(patch.contact?.phone).toBe('0311112222')
  })

  it('does not rewrite the provenance of what it left alone', () => {
    expect(patch.provenance?.name).toMatchObject({
      source: 'website',
      confirmed: true,
      discoveredAt: 10,
    })
    expect(patch.provenance?.['contact.phone']?.confirmed).toBe(true)
  })

  it('keeps an accepted inference, which is the weakest claim there is', () => {
    expect(patch.audience?.value.summary).toBe('Regulars from the flats behind the shop')
    expect(patch.audience?.confirmed).toBe(true)
    expect(patch.audience?.source).toBe('inferred')
  })

  it('keeps an accepted product at the price the owner stood behind', () => {
    const nasiLemak = patch.products?.find((item) => item.name === 'Nasi Lemak')
    expect(nasiLemak?.priceMinor).toBe(950)
    expect(nasiLemak?.confirmed).toBe(true)
  })

  /**
   * The other half of the deal. Acceptance freezes what was reviewed, not the
   * whole Brain: fields that were still unknown at review time were never
   * stamped, so a later read of the site can still fill them in. Without this,
   * a business that adds its address to its website could never have MARKA
   * notice.
   */
  it('still learns facts that were unknown when the owner accepted', () => {
    expect(patch.location?.city).toBe('Kuala Lumpur')
    expect(patch.location?.addressLine1).toBe('12 Jalan Telawi')
    expect(patch.contact?.email).toBe('hello@warungmakcik.com')
    expect(patch.provenance?.['location.city']).toMatchObject({
      source: 'website',
      confirmed: false,
    })
  })

  it('still fills sections the owner had nothing to accept', () => {
    expect(patch.marketing?.value.positioning).toBe('Affordable home cooking')
    expect(patch.brand?.value.voice).toBe('Warm')
  })

  /**
   * Accepting must be idempotent under re-analysis: running it twice more
   * cannot erode a confirmation one refresh at a time.
   */
  it('holds across repeated re-analysis', () => {
    const second = mergeWebsiteAnalysis(
      { ...reviewed, ...patch } as StoredBusiness,
      analysis(),
      { ...CONTEXT, now: NOW + 86_400_000 },
    )

    expect(second.name).toBe('Warung Mak Cik Bangsar')
    expect(second.contact?.phone).toBe('0311112222')
    expect(second.audience?.value.summary).toBe('Regulars from the flats behind the shop')
  })

  /**
   * Step 5 of the owner journey: an explicit edit after acceptance. A manual
   * correction is a stronger claim than an acceptance, and must be at least as
   * protected.
   */
  it('protects a manual edit made after acceptance', () => {
    const edited = {
      ...reviewed,
      ...patch,
      identity: { ...reviewed.identity, subIndustry: 'Nasi campur' },
      provenance: {
        ...patch.provenance,
        'identity.subIndustry': confirmedBy('user'),
      },
    } as StoredBusiness

    const third = mergeWebsiteAnalysis(edited, analysis(), { ...CONTEXT, now: NOW + 1000 })

    expect(third.identity?.subIndustry).toBe('Nasi campur')
    expect(third.provenance?.['identity.subIndustry']).toMatchObject({
      source: 'user',
      confirmed: true,
    })
  })
})

describe('mergeWebsiteAnalysis from a social page', () => {
  const FB_CONTEXT: MergeContext = {
    websiteUrl: 'https://www.facebook.com/warungmakcik/',
    pagesAnalysed: 1,
    now: NOW,
    source: 'facebook',
  }

  it('labels facts and products with the page they came from', () => {
    const patch = mergeWebsiteAnalysis(
      business(),
      analysis({
        products: [
          {
            name: 'Nasi Lemak',
            description: null,
            price: 8.5,
            currency: 'MYR',
            category: null,
            isSignature: false,
            attributes: [],
            sourceUrl: null,
            confidence: 0.7,
          },
        ],
      }),
      FB_CONTEXT,
    )

    expect(patch.provenance?.name).toMatchObject({ source: 'facebook' })
    expect(patch.products?.[0]).toMatchObject({
      source: 'facebook',
      sourceRef: 'https://www.facebook.com/warungmakcik/',
    })
    expect(patch.marketing?.source).toBe('facebook')
    expect(patch.operations?.source).toBe('facebook')
    // Reading between the lines is inference wherever the lines were read.
    expect(patch.audience?.source).toBe('inferred')
    expect(patch.brand?.source).toBe('inferred')
  })

  it('never turns a Facebook Page into the business website', () => {
    const empty = mergeWebsiteAnalysis(business(), analysis(), FB_CONTEXT)
    expect(empty.contact?.website).toBeNull()

    const withSite = mergeWebsiteAnalysis(
      business({
        contact: {
          email: null,
          phone: null,
          whatsapp: null,
          website: 'https://warungmakcik.com',
          socialProfiles: [],
        },
      }),
      analysis(),
      FB_CONTEXT,
    )
    expect(withSite.contact?.website).toBe('https://warungmakcik.com')
  })

  it('lists the analysed page among the social profiles, once', () => {
    const patch = mergeWebsiteAnalysis(business(), analysis(), FB_CONTEXT)
    const analysed = patch.contact?.socialProfiles.filter(
      (profile) => profile.url === 'https://www.facebook.com/warungmakcik/',
    )
    expect(analysed).toHaveLength(1)
    expect(analysed?.[0]).toMatchObject({ platform: 'facebook', handle: 'warungmakcik' })

    // Re-analysis must not duplicate it.
    const again = mergeWebsiteAnalysis(
      business({ contact: { ...business().contact, socialProfiles: patch.contact!.socialProfiles } }),
      analysis(),
      FB_CONTEXT,
    )
    expect(
      again.contact?.socialProfiles.filter(
        (profile) => profile.url === 'https://www.facebook.com/warungmakcik/',
      ),
    ).toHaveLength(1)
  })

  it('registers the page as its own source, next to an existing website', () => {
    const withWebsiteSource = business({
      sources: [
        {
          id: 'website',
          kind: 'website',
          label: 'Website',
          reference: 'https://warungmakcik.com',
          status: 'connected',
          lastSyncedAt: NOW - 5000,
        },
      ],
    })

    const patch = mergeWebsiteAnalysis(withWebsiteSource, analysis(), FB_CONTEXT)
    expect(patch.sources?.map((source) => source.id).sort()).toEqual(['facebook', 'website'])
    expect(patch.sources?.find((source) => source.id === 'facebook')).toMatchObject({
      kind: 'facebook',
      label: 'Facebook Page',
      reference: 'https://www.facebook.com/warungmakcik/',
    })
  })

  it('does not overwrite what the owner already confirmed', () => {
    const corrected = business({
      name: 'Warung Mak Cik Kiah',
      provenance: { name: confirmedBy('user') },
    })

    const patch = mergeWebsiteAnalysis(corrected, analysis(), FB_CONTEXT)
    expect(patch.name).toBe('Warung Mak Cik Kiah')
    expect(patch.provenance?.name).toMatchObject({ source: 'user', confirmed: true })
  })

  it('handles the Instagram labelling too', () => {
    const patch = mergeWebsiteAnalysis(business(), analysis(), {
      websiteUrl: 'https://www.instagram.com/warungmakcik/',
      pagesAnalysed: 1,
      now: NOW,
      source: 'instagram',
    })

    expect(patch.provenance?.name).toMatchObject({ source: 'instagram' })
    expect(patch.sources?.find((source) => source.id === 'instagram')).toMatchObject({
      label: 'Instagram profile',
    })
    expect(
      patch.contact?.socialProfiles.find(
        (profile) => profile.url === 'https://www.instagram.com/warungmakcik/',
      ),
    ).toMatchObject({ platform: 'instagram', handle: 'warungmakcik' })
  })
})
