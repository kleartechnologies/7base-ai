import { describe, expect, it } from 'vitest'

import type { Audience, BrandProfile, Business, Discovered, FieldProvenance, Product, SourceKind } from '@/types'
import {
  acceptBrain,
  acceptClaim,
  describeSource,
  emptyBusiness,
  hasUsefulKnowledge,
  provenanceForEdits,
  readFact,
  sourceTone,
  userDiscovered,
  userProvenance,
} from './brain'

/**
 * The client half of the authority model. What the owner types here is what
 * the backend merge later refuses to overwrite, so if these stamps are wrong,
 * §20 fails silently: a correction would look saved and then quietly vanish
 * on the next re-analysis.
 */

const NOW = 1_800_000_000_000

function stamp(source: SourceKind, confidence: number): FieldProvenance {
  return { source, sourceRef: null, confidence, confirmed: false, discoveredAt: 1, confirmedAt: null }
}

const websiteProvenance = (confidence: number) => stamp('website', confidence)
const inferredProvenance = (confidence: number) => stamp('inferred', confidence)

function discovered<T>(value: T, source: SourceKind, confidence: number): Discovered<T> {
  return { value, ...stamp(source, confidence) }
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
    source: 'website',
    sourceRef: null,
    confidence: 0.7,
    confirmed: false,
    ...over,
  }
}

function business(over: Partial<Business> = {}): Business {
  return {
    id: 'biz_1',
    ...(emptyBusiness('owner_1', { name: 'Warung Pak Din' }, 1) as Omit<Business, 'id'>),
    ...over,
  }
}

describe('userProvenance', () => {
  it('stamps an owner edit as the highest authority there is', () => {
    expect(userProvenance(NOW)).toEqual({
      source: 'user',
      sourceRef: null,
      confidence: 1,
      confirmed: true,
      confirmedAt: NOW,
      discoveredAt: NOW,
    })
  })
})

describe('userDiscovered', () => {
  it('wraps a section the owner wrote with the same authority', () => {
    expect(userDiscovered('Blunt and funny', NOW)).toEqual({
      value: 'Blunt and funny',
      source: 'user',
      sourceRef: null,
      confidence: 1,
      confirmed: true,
      confirmedAt: NOW,
      discoveredAt: NOW,
    })
  })
})

describe('emptyBusiness', () => {
  const created = emptyBusiness('owner_1', { name: '  Warung Pak Din  ' }, NOW)

  it('trims what the owner typed', () => {
    expect(created.name).toBe('Warung Pak Din')
  })

  it('claims no discovery, because security rules reject a forged one', () => {
    expect(created.discovery).toMatchObject({
      status: 'not_started',
      sourceRef: null,
      completedAt: null,
      pagesAnalysed: 0,
    })
    expect(created.sources).toEqual([])
  })

  it('marks the name as the owner’s, so analysis cannot rename their business', () => {
    expect(created.provenance.name).toEqual(userProvenance(NOW))
  })

  it('records an offering as owner-supplied when one was given', () => {
    const withOffering = emptyBusiness(
      'owner_1',
      { name: 'Warung Pak Din', offering: 'Nasi campur' },
      NOW,
    )
    expect(withOffering.identity.description).toBe('Nasi campur')
    expect(withOffering.provenance['identity.description']).toEqual(userProvenance(NOW))
  })

  it('leaves the description unclaimed when the owner skipped it', () => {
    // Nothing was said, so a later website reading is free to fill it in.
    expect(created.identity.description).toBeNull()
    expect(created.provenance['identity.description']).toBeUndefined()
  })

  it('defaults to a Malaysian F&B business, which is who MARKA is for', () => {
    expect(created.industry).toBe('food_and_beverage')
    expect(created.location.countryCode).toBe('MY')
  })
})

describe('readFact', () => {
  const facts = business({ name: 'Warung Pak Din' })

  it('reads a nested fact by its dotted path', () => {
    expect(readFact(facts, 'name')).toBe('Warung Pak Din')
    expect(readFact(facts, 'identity.tagline')).toBeNull()
    expect(readFact(facts, 'location.city')).toBeNull()
  })
})

describe('provenanceForEdits', () => {
  const existing = business({
    name: 'Warung Pak Din',
    identity: {
      legalName: null,
      tagline: 'Nasi campur since 1998',
      description: null,
      category: 'Restaurant',
      subIndustry: null,
      businessType: null,
      foundedYear: null,
    },
    provenance: {
      name: userProvenance(1),
      'identity.tagline': {
        source: 'website',
        sourceRef: 'https://warungpakdin.com',
        confidence: 0.8,
        confirmed: false,
        discoveredAt: 1,
      },
      'identity.category': {
        source: 'website',
        sourceRef: 'https://warungpakdin.com',
        confidence: 0.8,
        confirmed: false,
        discoveredAt: 1,
      },
    },
  })

  it('stamps a corrected field as the owner’s', () => {
    const next = provenanceForEdits(
      existing,
      { ...existing, identity: { ...existing.identity, tagline: 'Kampung food, city prices' } },
      NOW,
    )
    expect(next['identity.tagline']).toEqual(userProvenance(NOW))
  })

  it('leaves untouched fields exactly as they were', () => {
    // Clicking "looks good" is not the same as vouching for every line — and
    // pretending otherwise would freeze the Brain against ever refreshing.
    const next = provenanceForEdits(existing, { ...existing }, NOW)
    expect(next['identity.category']).toEqual(existing.provenance['identity.category'])
    expect(next).toEqual(existing.provenance)
  })

  it('stamps a field the owner cleared, so it is not silently refilled', () => {
    const next = provenanceForEdits(
      existing,
      { ...existing, identity: { ...existing.identity, category: null } },
      NOW,
    )
    expect(next['identity.category']).toEqual(userProvenance(NOW))
  })

  it('stamps a field the owner filled in for the first time', () => {
    const next = provenanceForEdits(
      existing,
      { ...existing, contact: { ...existing.contact, phone: '03-2201 1188' } },
      NOW,
    )
    expect(next['contact.phone']).toEqual(userProvenance(NOW))
  })

  it('compares list values structurally rather than by identity', () => {
    const withSocial = business({
      contact: {
        ...existing.contact,
        socialProfiles: [{ platform: 'facebook', handle: 'pakdin', url: 'https://fb.com/pakdin' }],
      },
      provenance: existing.provenance,
    })

    const unchanged = provenanceForEdits(
      withSocial,
      {
        ...withSocial,
        contact: {
          ...withSocial.contact,
          socialProfiles: [{ platform: 'facebook', handle: 'pakdin', url: 'https://fb.com/pakdin' }],
        },
      },
      NOW,
    )
    expect(unchanged['contact.socialProfiles']).toBeUndefined()

    const changed = provenanceForEdits(
      withSocial,
      { ...withSocial, contact: { ...withSocial.contact, socialProfiles: [] } },
      NOW,
    )
    expect(changed['contact.socialProfiles']).toEqual(userProvenance(NOW))
  })

  it('does not invent provenance for fields outside the recorded set', () => {
    const next = provenanceForEdits(existing, { ...existing }, NOW)
    expect(next['identity.foundedYear']).toBeUndefined()
    expect(next['contact.website']).toBeUndefined()
  })
})

describe('hasUsefulKnowledge', () => {
  it('is false for a business MARKA knows nothing about beyond its name', () => {
    expect(hasUsefulKnowledge(business())).toBe(false)
    expect(hasUsefulKnowledge(null)).toBe(false)
  })

  it('is true once there is something worth reviewing', () => {
    expect(
      hasUsefulKnowledge(
        business({
          identity: { ...business().identity, description: 'A warung in Bangsar' },
        }),
      ),
    ).toBe(true)
    expect(hasUsefulKnowledge(business({ audience: userDiscovered({
      summary: 'Office workers',
      segments: [],
      customerTypes: [],
      demographics: [],
      useCases: [],
      needs: [],
      preferences: [],
    }, NOW) }))).toBe(true)
  })
})

describe('describeSource', () => {
  it('says plainly where each piece of knowledge came from', () => {
    expect(describeSource(userProvenance(NOW))).toBe('Confirmed by you')
    expect(describeSource({ source: 'website', confirmed: false })).toBe('From your website')
    expect(describeSource({ source: 'inferred', confirmed: false })).toBe('EVA\u2019s inference')
    expect(describeSource({ source: 'document', confirmed: false })).toBe(
      'From a document you uploaded',
    )
    expect(describeSource({ source: 'facebook', confirmed: false })).toBe(
      'From your Facebook Page',
    )
    expect(describeSource({ source: 'instagram', confirmed: false })).toBe(
      'From your Instagram profile',
    )
    expect(describeSource({ source: 'pos', confirmed: false })).toBe('From a connected source')
  })

  it('calls a confirmed guess what it now is: the owner\u2019s answer', () => {
    expect(describeSource({ source: 'inferred', confirmed: true })).toBe('Confirmed by you')
  })

  it('says nothing when there is nothing to attribute', () => {
    expect(describeSource(null)).toBeNull()
    expect(describeSource(undefined)).toBeNull()
  })
})

describe('sourceTone', () => {
  it('separates a fact, a guess and an answer', () => {
    expect(sourceTone({ source: 'website', confirmed: false })).toBe('sourced')
    expect(sourceTone({ source: 'inferred', confirmed: false })).toBe('inferred')
    expect(sourceTone({ source: 'website', confirmed: true })).toBe('confirmed')
    expect(sourceTone({ source: 'user', confirmed: false })).toBe('confirmed')
    expect(sourceTone(null)).toBeNull()
  })

  it('agrees with describeSource on every claim', () => {
    for (const source of ['user', 'website', 'inferred', 'document', 'instagram'] as const) {
      for (const confirmed of [true, false]) {
        const claim = { source, confirmed }
        expect(Boolean(describeSource(claim))).toBe(Boolean(sourceTone(claim)))
        if (sourceTone(claim) === 'confirmed') {
          expect(describeSource(claim)).toBe('Confirmed by you')
        }
      }
    }
  })
})

/**
 * "Looks good" is a real act of authority, and the model has to record it
 * without lying about it.
 *
 * The temptation is to restamp everything the owner accepted as `source: 'user'`
 * — it would protect the values with the machinery that already exists. But it
 * would also mean MARKA telling the owner, forever after, that they said things
 * they only nodded at. So acceptance keeps the original source and adds
 * `confirmed`; `authorityOf` already treats any confirmed claim as final.
 */
describe('acceptClaim', () => {
  it('marks a website fact as accepted without pretending the owner wrote it', () => {
    const accepted = acceptClaim(
      { source: 'website', sourceRef: 'https://x.my', confidence: 0.8, confirmed: false, discoveredAt: 1, confirmedAt: null },
      NOW,
    )

    expect(accepted.source).toBe('website')
    expect(accepted.sourceRef).toBe('https://x.my')
    expect(accepted.confirmed).toBe(true)
    expect(accepted.confirmedAt).toBe(NOW)
  })

  it('leaves an already-confirmed claim exactly as it was', () => {
    const original = userProvenance(1)
    expect(acceptClaim(original, NOW)).toBe(original)
  })

  it('does not inflate the confidence MARKA actually had', () => {
    const accepted = acceptClaim(
      { source: 'inferred', sourceRef: null, confidence: 0.4, confirmed: false, discoveredAt: 1, confirmedAt: null },
      NOW,
    )

    expect(accepted.confidence).toBe(0.4)
    expect(accepted.source).toBe('inferred')
  })
})

describe('acceptBrain', () => {
  const reviewed = business({
    name: 'Kedai Kopi Aman',
    identity: {
      legalName: null,
      tagline: null,
      description: 'Kopitiam in Bangsar',
      category: 'restaurant',
      subIndustry: 'kopitiam',
      businessType: 'Cafe',
      foundedYear: null,
    },
    provenance: {
      name: websiteProvenance(0.9),
      'identity.description': websiteProvenance(0.8),
      'identity.subIndustry': inferredProvenance(0.4),
    },
    products: [product({ id: 'p1', name: 'Kopi O', confirmed: false })],
    audience: discovered({ summary: 'Office workers' } as Audience, 'inferred', 0.4),
    brand: discovered({ voice: 'Warm' } as BrandProfile, 'website', 0.7),
  })

  it('confirms every fact the owner reviewed, keeping where it came from', () => {
    const accepted = acceptBrain(reviewed, NOW)

    expect(accepted.provenance.name).toMatchObject({
      source: 'website',
      confirmed: true,
      confirmedAt: NOW,
    })
    expect(accepted.provenance['identity.subIndustry']).toMatchObject({
      source: 'inferred',
      confirmed: true,
      confirmedAt: NOW,
    })
  })

  it('confirms the wrapped sections and the products under review', () => {
    const accepted = acceptBrain(reviewed, NOW)

    expect(accepted.audience).toMatchObject({ source: 'inferred', confirmed: true, confirmedAt: NOW })
    expect(accepted.brand).toMatchObject({ source: 'website', confirmed: true, confirmedAt: NOW })
    expect(accepted.products[0]).toMatchObject({
      source: 'website',
      confirmed: true,
      confirmedAt: NOW,
    })
  })

  it('leaves sections MARKA never filled in alone', () => {
    const accepted = acceptBrain(reviewed, NOW)

    expect(accepted.marketing).toBeNull()
    expect(accepted.operations).toBeNull()
  })

  /**
   * The point of the whole exercise: accepting what MARKA *did* find must not
   * freeze what it did *not*. A field left blank at review time has to stay
   * open to the next website read, or a business that adds a phone number to
   * its site could never have MARKA notice.
   */
  it('does not stamp fields that are still unknown', () => {
    const accepted = acceptBrain(reviewed, NOW)

    expect(accepted.provenance['contact.phone']).toBeUndefined()
    expect(accepted.provenance['location.city']).toBeUndefined()
    expect(accepted.provenance['identity.tagline']).toBeUndefined()
  })

  it('changes nothing else about the Brain', () => {
    const accepted = acceptBrain(reviewed, NOW)

    expect(accepted.products[0]).toMatchObject({ name: 'Kopi O' })
    expect(accepted.audience?.value).toEqual(reviewed.audience?.value)
    expect(Object.keys(accepted)).toEqual([
      'provenance',
      'products',
      'audience',
      'brand',
      'marketing',
      'operations',
    ])
  })
})
