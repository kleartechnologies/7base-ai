import { describe, expect, it } from 'vitest'

import type { StoredRecommendation } from '../marketing/store'
import { draftCampaignFromRecommendation } from './draft'
import { buildStoredCampaign } from './store'

/**
 * The persisted shape. Security depends on it: the stored campaign carries
 * the authenticated uid, the verified business and conversation ids, and the
 * recommendation it was built from — never anything a client asserted.
 */

const rec = {
  ownerSummary: 'x',
  goal: 'Increase weekday customers',
  diagnosis: { statement: 'Weekday demand appears low.', basis: 'hypothesis' },
  opportunities: [
    {
      title: 'Weekday lunch traffic',
      description: 'Promote lunch sets.',
      evidence: [],
      assumptions: [],
      potentialImpact: 'high_potential',
      effort: 'medium',
      suitability: null,
    },
  ],
  recommendedIndex: 0,
  rationale: [],
  targetAudience: null,
  offer: null,
  positioning: null,
  coreMessage: null,
  callToAction: null,
  channels: [],
  durationDays: null,
  confidence: 'low',
  confidenceReason: null,
  assumptions: [],
  unknowns: [],
  nextAction: 'build_campaign',
  ownerId: 'user1',
  businessId: 'biz1',
  conversationId: 'conv1',
  status: 'proposed',
  meta: null,
  createdAt: 1000,
  updatedAt: 1000,
} satisfies StoredRecommendation

describe('buildStoredCampaign', () => {
  const stored = buildStoredCampaign({
    ownerId: 'user1',
    businessId: 'biz1',
    conversationId: 'conv1',
    sourceRecommendationId: 'rec1',
    content: draftCampaignFromRecommendation(rec),
    meta: { model: 'gpt-test', task: 'campaign.build', latencyMs: 100, usage: null },
    now: 4321,
  })

  it('binds the campaign to its user, business, conversation and recommendation', () => {
    expect(stored.ownerId).toBe('user1')
    expect(stored.businessId).toBe('biz1')
    expect(stored.conversationId).toBe('conv1')
    expect(stored.sourceRecommendationId).toBe('rec1')
  })

  it('starts life as an unedited draft', () => {
    expect(stored.status).toBe('draft')
    expect(stored.userEdited).toEqual([])
    expect(stored.createdAt).toBe(4321)
    expect(stored.updatedAt).toBe(4321)
  })

  it('carries the drafted content', () => {
    expect(stored.name).toBe('Weekday lunch traffic')
    expect(stored.objective).toBe('Increase weekday customers')
    expect(stored.meta?.task).toBe('campaign.build')
  })
})
