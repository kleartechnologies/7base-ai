import { describe, expect, it } from 'vitest'

import type { StoredCampaign } from '../campaign/store'
import type { StoredBusiness } from '../lib/business.types'
import { selectBusinessImage } from './image'

/**
 * Real photos beat generated ones — a product rule enforced by a
 * deterministic selector, not a model call. These tests pin the preference
 * order: named in the campaign, else the signature dish, else the first
 * usable photo; and only https images qualify.
 */

const campaign = {
  name: 'Weekday Lunch Growth',
  objective: 'Increase weekday lunch customers',
  targetAudience: null,
  offer: { description: 'A weekday Nasi Lemak Ayam set', basis: 'recommendation' },
  positioning: null,
  keyMessage: 'Lunch without the wait',
  callToAction: null,
  channels: [],
  durationDays: null,
  startDate: null,
  endDate: null,
  notes: null,
  assumptions: [],
  unknowns: [],
  ownerId: 'user1',
  businessId: 'biz1',
  conversationId: null,
  sourceRecommendationId: null,
  status: 'draft',
  userEdited: [],
  meta: null,
  createdAt: 1,
  updatedAt: 1,
} as StoredCampaign

function makeBusiness(products: unknown[]): StoredBusiness {
  return { products } as unknown as StoredBusiness
}

const laksa = {
  name: 'Curry Laksa',
  imageUrl: 'https://cdn.example/laksa.jpg',
  isSignature: true,
}
const nasiLemak = {
  name: 'Nasi Lemak Ayam',
  imageUrl: 'https://cdn.example/nasi.jpg',
  isSignature: false,
}
const teh = { name: 'Teh Tarik', imageUrl: 'https://cdn.example/teh.jpg', isSignature: false }

describe('selectBusinessImage', () => {
  it('returns null with no business or no usable photos', () => {
    expect(selectBusinessImage(null, campaign)).toBeNull()
    expect(selectBusinessImage(makeBusiness([]), campaign)).toBeNull()
    expect(
      selectBusinessImage(makeBusiness([{ name: 'X', imageUrl: null, isSignature: true }]), campaign),
    ).toBeNull()
  })

  it('only https images qualify — no http, no data URIs', () => {
    expect(
      selectBusinessImage(
        makeBusiness([{ name: 'X', imageUrl: 'http://cdn.example/x.jpg', isSignature: true }]),
        campaign,
      ),
    ).toBeNull()
  })

  it('prefers the product the campaign actually talks about', () => {
    const selected = selectBusinessImage(makeBusiness([laksa, nasiLemak, teh]), campaign)
    expect(selected?.product.name).toBe('Nasi Lemak Ayam')
    expect(selected?.url).toBe('https://cdn.example/nasi.jpg')
  })

  it('falls back to the signature dish, then to the first photo', () => {
    const noMention = { ...campaign, offer: null, name: 'Generic Push', objective: null }
    const signature = selectBusinessImage(makeBusiness([teh, laksa]), noMention as StoredCampaign)
    expect(signature?.product.name).toBe('Curry Laksa')

    const first = selectBusinessImage(makeBusiness([teh, nasiLemak]), noMention as StoredCampaign)
    expect(first?.product.name).toBe('Teh Tarik')
  })

  it('is deterministic — same inputs, same photo', () => {
    const business = makeBusiness([laksa, nasiLemak, teh])
    expect(selectBusinessImage(business, campaign)).toEqual(
      selectBusinessImage(business, campaign),
    )
  })
})
