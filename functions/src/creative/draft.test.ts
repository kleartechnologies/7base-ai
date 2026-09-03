import { describe, expect, it } from 'vitest'

import type { StoredCampaign } from '../campaign/store'
import type { StoredBusiness } from '../lib/business.types'
import {
  buildCreativeEditCorpus,
  buildGroundingCorpus,
  draftCreativeCopyFromCampaign,
  mergeCopy,
} from './draft'

/**
 * The deterministic draft is why "Create Marketing Materials" cannot fail:
 * it is assembled purely from campaign fields the owner already approved, so
 * it can never claim anything the campaign does not — and the model call is
 * an improvement on top, not a dependency.
 */

const campaign: StoredCampaign = {
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
  assumptions: ['Office crowd works nearby'],
  unknowns: ['Pricing not confirmed'],
  ownerId: 'user1',
  businessId: 'biz1',
  conversationId: 'conv1',
  sourceRecommendationId: 'rec1',
  status: 'draft',
  userEdited: [],
  meta: null,
  createdAt: 1000,
  updatedAt: 1000,
}

// Only the fields the corpus builder reads; the full StoredBusiness carries
// far more than grounding needs.
const business = {
  ownerId: 'user1',
  name: 'Secret Recipe Kopitiam',
  contact: { website: 'https://secretrecipe.example', whatsapp: '+60123456789' },
  products: [
    {
      name: 'Nasi Lemak Ayam',
      description: 'Fragrant coconut rice with fried chicken',
      priceMinor: 1290,
      imageUrl: null,
      isSignature: true,
    },
  ],
  marketing: {
    value: { promotions: ['Set lunch promo'], callsToAction: ['Order on WhatsApp'] },
  },
} as unknown as StoredBusiness

describe('draftCreativeCopyFromCampaign', () => {
  const draft = draftCreativeCopyFromCampaign(campaign)

  it('builds the poster text from the campaign, word for word', () => {
    expect(draft.name).toBe('Weekday Lunch Growth Poster')
    expect(draft.content.headline).toBe('Lunch without the wait')
    expect(draft.content.callToAction).toBe('Order on WhatsApp')
    expect(draft.content.offerText).toBe('Consider a weekday lunch set')
    expect(draft.content.subheadline).toBeNull()
  })

  it('composes the caption from message and CTA, nothing more', () => {
    expect(draft.captions.short).toBe('Lunch without the wait Order on WhatsApp.')
    expect(draft.captions.facebook).toBe(draft.captions.short)
    expect(draft.captions.instagram).toBe(draft.captions.short)
  })

  it('writes WhatsApp copy only when WhatsApp is a campaign channel', () => {
    expect(draft.captions.whatsapp).not.toBeNull()
    const without = draftCreativeCopyFromCampaign({ ...campaign, channels: ['instagram'] })
    expect(without.captions.whatsapp).toBeNull()
  })

  it('falls back to the campaign name when there is no key message', () => {
    const bare = draftCreativeCopyFromCampaign({
      ...campaign,
      keyMessage: null,
      callToAction: null,
    })
    expect(bare.content.headline).toBe('Weekday Lunch Growth')
    expect(bare.captions.short).toBe('Weekday Lunch Growth')
  })

  it('is deterministic — same campaign in, same draft out', () => {
    expect(draftCreativeCopyFromCampaign(campaign)).toEqual(draft)
  })
})

describe('mergeCopy', () => {
  const fallback = draftCreativeCopyFromCampaign(campaign)

  it('a null model field keeps the deterministic value — refusal costs nothing', () => {
    const merged = mergeCopy(fallback, {
      name: null,
      headline: 'Real lunch, real fast',
      subheadline: 'Ready in ten minutes',
      callToAction: null,
      offerText: null,
      facebookCaption: null,
      instagramCaption: null,
      shortCopy: null,
      whatsappCopy: null,
      imageBrief: 'A plate of nasi lemak on a kopitiam table',
      altText: null,
    })
    expect(merged.content.headline).toBe('Real lunch, real fast')
    expect(merged.content.subheadline).toBe('Ready in ten minutes')
    expect(merged.content.callToAction).toBe('Order on WhatsApp')
    expect(merged.content.offerText).toBe('Consider a weekday lunch set')
    expect(merged.captions.facebook).toBe(fallback.captions.facebook)
    expect(merged.name).toBe(fallback.name)
  })
})

describe('buildGroundingCorpus', () => {
  it('holds the campaign, the products and their printed prices', () => {
    const corpus = buildGroundingCorpus({ campaign, business })
    expect(corpus).toContain('Lunch without the wait')
    expect(corpus).toContain('Consider a weekday lunch set')
    expect(corpus).toContain('Nasi Lemak Ayam')
    expect(corpus).toContain('RM12.90')
    expect(corpus).toContain('https://secretrecipe.example')
    expect(corpus).toContain('Set lunch promo')
  })

  it('works with no business at all', () => {
    const corpus = buildGroundingCorpus({ campaign, business: null })
    expect(corpus).toContain('Weekday Lunch Growth')
    expect(corpus).not.toContain('RM12.90')
  })

  it('includes extra sources — the edit path passes the instruction here', () => {
    const corpus = buildGroundingCorpus({
      campaign,
      business: null,
      extra: ['Set the price to RM15.00'],
    })
    expect(corpus).toContain('RM15.00')
  })
})

describe('buildCreativeEditCorpus', () => {
  const creative = {
    name: 'Weekday Lunch Growth Poster',
    content: {
      headline: 'Set lunch at RM12.90',
      subheadline: null,
      body: null,
      callToAction: 'Order on WhatsApp',
      offerText: null,
    },
    captions: { facebook: null, instagram: null, short: null, whatsapp: null },
    ownerDirectives: ["Don't mention discounts"],
  }

  it("includes the creative's own copy — an existing price stays claimable", () => {
    const corpus = buildCreativeEditCorpus({
      creative,
      campaign,
      business: null,
      instruction: 'Make the headline more premium',
    })
    expect(corpus).toContain('Set lunch at RM12.90')
    expect(corpus).toContain('Make the headline more premium')
    expect(corpus).toContain("Don't mention discounts")
    expect(corpus).toContain('Lunch without the wait')
  })

  it('still grounds against the creative and instruction when the campaign is gone', () => {
    const corpus = buildCreativeEditCorpus({
      creative,
      campaign: null,
      business: null,
      instruction: 'Shorten it',
    })
    expect(corpus).toContain('Set lunch at RM12.90')
    expect(corpus).toContain('Shorten it')
    expect(corpus).not.toContain('Weekday Lunch Growth\n')
  })
})
