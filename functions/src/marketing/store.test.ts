import { describe, expect, it } from 'vitest'

import { buildStoredRecommendation } from './store'
import type { MarketingRecommendationDraft } from './validate'

/**
 * The persisted shape. Ownership is what security depends on: the stored
 * document must carry the authenticated uid and the verified business and
 * conversation ids — never anything a client asserted.
 */

const draft: MarketingRecommendationDraft = {
  ownerSummary: 'Weekday lunch looks like your best opening.',
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
}

describe('buildStoredRecommendation', () => {
  it('binds the recommendation to its user, business and conversation', () => {
    const stored = buildStoredRecommendation({
      ownerId: 'user1',
      businessId: 'biz1',
      conversationId: 'conv1',
      draft,
      meta: { model: 'gpt-test', task: 'campaign.diagnose', latencyMs: 100, usage: null },
      now: 1234,
    })

    expect(stored.ownerId).toBe('user1')
    expect(stored.businessId).toBe('biz1')
    expect(stored.conversationId).toBe('conv1')
    expect(stored.status).toBe('proposed')
    expect(stored.createdAt).toBe(1234)
    expect(stored.updatedAt).toBe(1234)
    expect(stored.goal).toBe('Increase weekday customers')
    expect(stored.meta?.task).toBe('campaign.diagnose')
  })
})
