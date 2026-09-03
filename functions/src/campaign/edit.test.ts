import { describe, expect, it } from 'vitest'

import { applyCampaignPatch } from './edit'
import type { StoredCampaign } from './store'

/**
 * Edit authority, pinned. "Don't use discounts" must survive every later AI
 * update — deterministically, via the `userEdited` ledger, not via prompt
 * discipline. And nothing any patch claims can promote a hypothesis to
 * 'known' or a recommended offer to 'existing'.
 */

function campaign(over: Partial<StoredCampaign> = {}): StoredCampaign {
  return {
    ownerId: 'user1',
    businessId: 'biz1',
    conversationId: 'conv1',
    sourceRecommendationId: 'rec1',
    name: 'Weekday Lunch Rush',
    status: 'draft',
    objective: 'Increase weekday customers',
    targetAudience: { description: 'Nearby office workers', basis: 'known' },
    offer: { description: 'Weekday lunch set', basis: 'recommendation' },
    positioning: 'The fast, honest lunch nearby',
    keyMessage: 'Lunch without the wait',
    callToAction: 'Order on WhatsApp',
    channels: ['instagram', 'whatsapp'],
    durationDays: 14,
    startDate: null,
    endDate: null,
    notes: null,
    assumptions: [],
    unknowns: ['Pricing not confirmed'],
    userEdited: [],
    meta: null,
    createdAt: 1000,
    updatedAt: 1000,
    ...over,
  }
}

describe('applyCampaignPatch — user instructions', () => {
  it('applies the change, records authority, bumps updatedAt', () => {
    const { campaign: next, changed } = applyCampaignPatch(
      campaign(),
      { keyMessage: 'An honest lunch, done properly' },
      'user_instruction',
      2000,
    )
    expect(next.keyMessage).toBe('An honest lunch, done properly')
    expect(changed).toEqual(['keyMessage'])
    expect(next.userEdited).toEqual(['keyMessage'])
    expect(next.updatedAt).toBe(2000)
  })

  it('leaves unrelated fields exactly as they were', () => {
    const before = campaign()
    const { campaign: next } = applyCampaignPatch(
      before,
      { durationDays: 30 },
      'user_instruction',
    )
    expect(next.durationDays).toBe(30)
    expect(next.name).toBe(before.name)
    expect(next.offer).toEqual(before.offer)
    expect(next.targetAudience).toEqual(before.targetAudience)
    expect(next.channels).toEqual(before.channels)
    expect(next.unknowns).toEqual(before.unknowns)
    expect(next.sourceRecommendationId).toBe('rec1')
  })

  it('a no-op patch changes nothing, not even updatedAt', () => {
    const before = campaign()
    const { campaign: next, changed } = applyCampaignPatch(
      before,
      { keyMessage: 'Lunch without the wait' },
      'user_instruction',
      2000,
    )
    expect(changed).toEqual([])
    expect(next.updatedAt).toBe(1000)
    expect(next.userEdited).toEqual([])
  })

  it('accumulates authority across successive instructions', () => {
    const first = applyCampaignPatch(campaign(), { name: 'Lunch Club' }, 'user_instruction')
    const second = applyCampaignPatch(
      first.campaign,
      { durationDays: 30 },
      'user_instruction',
    )
    expect(second.campaign.userEdited.sort()).toEqual(['durationDays', 'name'])
  })
})

describe('applyCampaignPatch — assistant updates respect owner authority', () => {
  it('an assistant patch cannot touch an owner-set field', () => {
    const owned = campaign({
      offer: { description: 'Set lunch, no discounts', basis: 'recommendation' },
      userEdited: ['offer'],
    })
    const { campaign: next, changed } = applyCampaignPatch(
      owned,
      { offer: { description: '20% discount lunch deal', basis: 'recommendation' } },
      'assistant',
    )
    expect(changed).toEqual([])
    expect(next.offer?.description).toBe('Set lunch, no discounts')
  })

  it('an assistant patch may change unowned fields, without claiming authority', () => {
    const { campaign: next, changed } = applyCampaignPatch(
      campaign({ userEdited: ['offer'] }),
      { keyMessage: 'A better message' },
      'assistant',
    )
    expect(changed).toEqual(['keyMessage'])
    expect(next.keyMessage).toBe('A better message')
    expect(next.userEdited).toEqual(['offer'])
  })

  it('"don\'t use discounts" survives an unrelated AI update end to end', () => {
    // The user forbids discounts; the offer becomes owner-set.
    const afterUser = applyCampaignPatch(
      campaign(),
      { offer: { description: 'Set lunch at full price', basis: 'recommendation' } },
      'user_instruction',
    ).campaign
    // A later assistant edit proposes a broad rewrite including the offer.
    const afterAi = applyCampaignPatch(
      afterUser,
      {
        keyMessage: 'Premium lunch, done properly',
        offer: { description: 'Discounted lunch promo', basis: 'recommendation' },
      },
      'assistant',
    )
    expect(afterAi.campaign.keyMessage).toBe('Premium lunch, done properly')
    expect(afterAi.campaign.offer?.description).toBe('Set lunch at full price')
    expect(afterAi.changed).toEqual(['keyMessage'])
  })
})

describe('applyCampaignPatch — basis is never upgraded', () => {
  it('a changed audience is a hypothesis even if the patch claims known', () => {
    const { campaign: next } = applyCampaignPatch(
      campaign(),
      { targetAudience: { description: 'Families with young kids', basis: 'known' } },
      'user_instruction',
    )
    expect(next.targetAudience).toEqual({
      description: 'Families with young kids',
      basis: 'hypothesis',
    })
  })

  it('an unchanged audience description keeps the basis it earned', () => {
    const { campaign: next, changed } = applyCampaignPatch(
      campaign(),
      { targetAudience: { description: 'Nearby office workers', basis: 'hypothesis' } },
      'user_instruction',
    )
    expect(changed).toEqual([])
    expect(next.targetAudience?.basis).toBe('known')
  })

  it('a changed offer is a recommendation even if the patch claims existing', () => {
    const { campaign: next } = applyCampaignPatch(
      campaign(),
      { offer: { description: 'Free dessert with every set', basis: 'existing' } },
      'user_instruction',
    )
    expect(next.offer).toEqual({
      description: 'Free dessert with every set',
      basis: 'recommendation',
    })
  })
})
