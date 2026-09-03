import { describe, expect, it } from 'vitest'

import type { StoredRecommendation } from '../marketing/store'
import { draftCampaignFromRecommendation, mergePolish } from './draft'

/**
 * Grounding by construction. The recommendation earned its authority through
 * the Brain; the campaign inherits exactly that authority because these
 * fields are copied, never regenerated. If any of these tests fail, a model
 * has been given a chance to rewrite provenance.
 */

const rec: StoredRecommendation = {
  ownerSummary: 'Weekday lunch looks like your best opening.',
  goal: 'Increase weekday customers',
  diagnosis: { statement: 'Weekday lunch demand appears low.', basis: 'hypothesis' },
  opportunities: [
    {
      title: 'Weekday lunch traffic',
      description: 'Promote lunch sets to nearby office workers.',
      evidence: [],
      assumptions: ['Office crowd works nearby'],
      potentialImpact: 'high_potential',
      effort: 'medium',
      suitability: null,
    },
  ],
  recommendedIndex: 0,
  rationale: [],
  targetAudience: { description: 'Nearby office workers', basis: 'known' },
  offer: { description: 'Weekday lunch set', basis: 'recommendation' },
  positioning: 'The fast, honest lunch nearby',
  coreMessage: 'Lunch without the wait',
  callToAction: 'Order on WhatsApp',
  channels: ['instagram', 'whatsapp'],
  durationDays: 14,
  confidence: 'medium',
  confidenceReason: null,
  assumptions: ['Weekday lunch demand exists', 'Office crowd works nearby'],
  unknowns: ['Pricing not confirmed'],
  nextAction: 'build_campaign',
  ownerId: 'user1',
  businessId: 'biz1',
  conversationId: 'conv1',
  status: 'proposed',
  meta: null,
  createdAt: 1000,
  updatedAt: 1000,
}

describe('draftCampaignFromRecommendation', () => {
  const draft = draftCampaignFromRecommendation(rec)

  it('names the campaign after the recommended opportunity, with the goal as objective', () => {
    expect(draft.name).toBe('Weekday lunch traffic')
    expect(draft.objective).toBe('Increase weekday customers')
  })

  it('copies the audience with its basis intact — known stays known, and nothing invents one', () => {
    expect(draft.targetAudience).toEqual({ description: 'Nearby office workers', basis: 'known' })
    // A copy, not a shared reference: later edits must not reach back.
    expect(draft.targetAudience).not.toBe(rec.targetAudience)
  })

  it('keeps a recommended offer a recommendation — it never becomes an existing offer', () => {
    expect(draft.offer).toEqual({ description: 'Weekday lunch set', basis: 'recommendation' })
  })

  it('copies strategy fields verbatim', () => {
    expect(draft.positioning).toBe('The fast, honest lunch nearby')
    expect(draft.keyMessage).toBe('Lunch without the wait')
    expect(draft.callToAction).toBe('Order on WhatsApp')
    expect(draft.channels).toEqual(['instagram', 'whatsapp'])
    expect(draft.channels).not.toBe(rec.channels)
    expect(draft.durationDays).toBe(14)
  })

  it('leaves dates and notes unset rather than inventing them', () => {
    expect(draft.startDate).toBeNull()
    expect(draft.endDate).toBeNull()
    expect(draft.notes).toBeNull()
  })

  it('carries assumptions (deduplicated) and unknowns onto the campaign', () => {
    expect(draft.assumptions).toEqual([
      'Weekday lunch demand exists',
      'Office crowd works nearby',
    ])
    expect(draft.unknowns).toEqual(['Pricing not confirmed'])
  })

  it('handles a recommendation with nothing but the essentials', () => {
    const bare = draftCampaignFromRecommendation({
      ...rec,
      targetAudience: null,
      offer: null,
      positioning: null,
      coreMessage: null,
      callToAction: null,
      channels: [],
      durationDays: null,
      assumptions: [],
      unknowns: [],
    })
    expect(bare.name).toBe('Weekday lunch traffic')
    expect(bare.targetAudience).toBeNull()
    expect(bare.offer).toBeNull()
    expect(bare.channels).toEqual([])
    // The campaign exists with unknowns rather than invented values.
    expect(bare.durationDays).toBeNull()
  })
})

describe('mergePolish', () => {
  const draft = draftCampaignFromRecommendation(rec)

  it('null polish keeps every deterministic value', () => {
    const merged = mergePolish(draft, {
      name: null,
      objective: null,
      keyMessage: null,
      callToAction: null,
      notes: null,
    })
    expect(merged).toEqual(draft)
  })

  it('polish contributes copy without touching authority fields', () => {
    const merged = mergePolish(draft, {
      name: 'Weekday Lunch Rush',
      objective: null,
      keyMessage: 'Set lunch, ready in 10 minutes',
      callToAction: null,
      notes: 'Confirm pricing before launch.',
    })
    expect(merged.name).toBe('Weekday Lunch Rush')
    expect(merged.keyMessage).toBe('Set lunch, ready in 10 minutes')
    expect(merged.notes).toBe('Confirm pricing before launch.')
    // Untouched by construction: not even present in the polish shape.
    expect(merged.targetAudience).toEqual(draft.targetAudience)
    expect(merged.offer).toEqual(draft.offer)
    expect(merged.channels).toEqual(draft.channels)
    expect(merged.durationDays).toBe(draft.durationDays)
    expect(merged.unknowns).toEqual(draft.unknowns)
  })
})
