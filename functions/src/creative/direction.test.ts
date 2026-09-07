import { describe, expect, it } from 'vitest'

import type { StoredCampaign } from '../campaign/store'
import type { StoredBusiness } from '../lib/business.types'
import {
  CREATIVE_DIRECTIONS,
  directionForPosition,
  directionRotation,
  selectDirection,
  type DirectionContext,
  type DirectionPhoto,
} from './direction'

/**
 * The direction is the poster's design brief, and it is decided in code: the
 * same campaign always yields the same one, no model is asked, and a set of
 * posters deliberately spreads across directions so three posters are three
 * designs rather than one design three times.
 */

const baseCampaign: StoredCampaign = {
  name: 'Weekday Lunch Growth',
  objective: 'Increase weekday lunch customers',
  targetAudience: { description: 'Nearby office workers', basis: 'known' },
  offer: { description: 'Consider a weekday lunch set', basis: 'recommendation' },
  positioning: 'The fast, honest lunch nearby',
  keyMessage: 'Lunch without the wait',
  callToAction: 'Order on WhatsApp',
  channels: ['instagram', 'whatsapp'],
  durationDays: 14,
  startDate: null,
  endDate: null,
  notes: null,
  assumptions: [],
  unknowns: [],
  ownerId: 'user1',
  businessId: 'biz1',
  conversationId: 'conv1',
  sourceRecommendationId: 'rec1',
  status: 'draft',
  userEdited: [],
  meta: null,
  createdAt: 1,
  updatedAt: 1,
}

function campaignWith(patch: Partial<StoredCampaign>): StoredCampaign {
  return { ...baseCampaign, ...patch }
}

function businessWith(patch: {
  industry?: StoredBusiness['industry']
  businessType?: string | null
  description?: string | null
  products?: { name: string }[]
}): StoredBusiness {
  return {
    ownerId: 'user1',
    name: 'Test Business',
    industry: patch.industry ?? 'other',
    identity: {
      legalName: null,
      tagline: null,
      description: patch.description ?? null,
      category: null,
      subIndustry: null,
      businessType: patch.businessType ?? null,
      foundedYear: null,
    },
    products: (patch.products ?? []).map((product, index) => ({
      id: `p${index}`,
      name: product.name,
      description: null,
      priceMinor: null,
      currency: 'MYR',
      category: null,
    })),
  } as unknown as StoredBusiness
}

function photo(patch: Partial<DirectionPhoto> = {}): DirectionPhoto {
  return { type: 'product', name: 'Nasi lemak plate', description: null, tags: [], ...patch }
}

function context(patch: Partial<DirectionContext>): DirectionContext {
  return { campaign: baseCampaign, business: null, photo: null, ...patch }
}

describe('selectDirection', () => {
  it('shows software as a product, not as a stock photo', () => {
    expect(
      selectDirection(
        context({
          campaign: campaignWith({ keyMessage: 'Muat turun aplikasi Matheasy hari ini' }),
        }),
      ),
    ).toBe('app_showcase')
    // A screenshot the owner uploaded says the same thing on its own.
    expect(
      selectDirection(context({ photo: photo({ name: 'App screenshot — home' }) })),
    ).toBe('app_showcase')
  })

  it('leads with the offer when there is a real one to print', () => {
    expect(
      selectDirection(
        context({
          campaign: campaignWith({
            offer: { description: 'RM19.90 lunch set, 12-3pm', basis: 'existing' },
          }),
        }),
      ),
    ).toBe('bold_promotional')
    // A recommendation is not an offer: "consider a lunch set" prints nothing.
    expect(selectDirection(context({}))).not.toBe('bold_promotional')
  })

  it('recognises teaching in either language', () => {
    for (const message of ['Faham setiap langkah, bukan hafal', 'Learn maths without stress']) {
      expect(selectDirection(context({ campaign: campaignWith({ keyMessage: message }) }))).toBe(
        'educational',
      )
    }
  })

  it("puts the owner's own food photo first", () => {
    expect(
      selectDirection(
        context({ business: businessWith({ industry: 'food_and_beverage' }), photo: photo() }),
      ),
    ).toBe('hero_product')
  })

  it('reads premium wording and a long product list', () => {
    expect(
      selectDirection(
        context({ campaign: campaignWith({ positioning: 'Artisan, handcrafted, exclusive' }) }),
      ),
    ).toBe('minimal_premium')
    expect(
      selectDirection(
        context({
          business: businessWith({
            products: [{ name: 'Facial' }, { name: 'Massage' }, { name: 'Manicure' }],
          }),
        }),
      ),
    ).toBe('feature_highlight')
  })

  it('falls back to a clean editorial poster, and is stable', () => {
    const subject = context({
      campaign: campaignWith({
        name: 'Awareness',
        objective: null,
        targetAudience: null,
        offer: null,
        positioning: null,
        keyMessage: 'We are open again',
        callToAction: 'Come by',
      }),
    })
    expect(selectDirection(subject)).toBe('clean_editorial')
    expect(selectDirection(subject)).toBe(selectDirection(subject))
  })
})

describe('directionForPosition', () => {
  it('gives a single poster exactly the direction that was chosen', () => {
    const subject = context({
      business: businessWith({ industry: 'food_and_beverage' }),
      photo: photo(),
    })
    expect(directionForPosition(subject, 0)).toBe(selectDirection(subject))
  })

  it('makes a set of three posters three different designs', () => {
    const subject = context({ business: businessWith({ industry: 'food_and_beverage' }), photo: photo() })
    const three = [0, 1, 2].map((position) => directionForPosition(subject, position))
    expect(new Set(three).size).toBe(3)
  })

  it('never repeats until every direction has been used', () => {
    const rotation = directionRotation(context({}))
    expect(rotation).toHaveLength(CREATIVE_DIRECTIONS.length)
    expect(new Set(rotation).size).toBe(CREATIVE_DIRECTIONS.length)
    // Past the end it wraps rather than running out.
    expect(directionForPosition(context({}), CREATIVE_DIRECTIONS.length)).toBe(rotation[0])
  })

  it('treats a nonsense position as the first one', () => {
    for (const position of [-1, 1.5, Number.NaN]) {
      expect(directionForPosition(context({}), position)).toBe(selectDirection(context({})))
    }
  })
})
