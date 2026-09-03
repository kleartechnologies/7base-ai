import { describe, expect, it } from 'vitest'

import { buildRecommendationPresentation } from './present'
import type { MarketingRecommendationDraft } from './validate'

/**
 * What the chat actually shows. The block must reference the persisted
 * recommendation rather than duplicate it, and the provenance labels on
 * audience and offer must survive — the card is where "hypothesis" finally
 * meets the owner's eyes.
 */

function draft(overrides: Partial<MarketingRecommendationDraft> = {}): MarketingRecommendationDraft {
  return {
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
    rationale: [
      { statement: 'Your menu lists lunch meals.', kind: 'fact', basedOn: 'products' },
      { statement: 'Office workers may be nearby.', kind: 'inference', basedOn: 'location' },
      { statement: 'A third reason.', kind: 'recommendation', basedOn: null },
    ],
    targetAudience: { description: 'Nearby working adults', basis: 'hypothesis' },
    offer: { description: 'Consider a weekday lunch set', basis: 'recommendation' },
    positioning: null,
    coreMessage: null,
    callToAction: null,
    channels: ['instagram'],
    durationDays: 14,
    confidence: 'medium',
    confidenceReason: null,
    assumptions: [],
    unknowns: [],
    nextAction: 'build_campaign',
    ...overrides,
  }
}

describe('buildRecommendationPresentation', () => {
  it('produces a conversational lead-in plus a recommendation block', () => {
    const { blocks, plainText } = buildRecommendationPresentation('rec1', draft())

    expect(blocks).toHaveLength(2)
    expect(blocks[0]).toMatchObject({ type: 'text', text: 'Weekday lunch looks like your best opening.' })
    expect(blocks[1]).toMatchObject({
      type: 'marketing_recommendation',
      recommendationId: 'rec1',
      title: 'Weekday lunch traffic',
      confidence: 'medium',
      nextAction: 'build_campaign',
    })
    expect(plainText).toContain('Recommended focus: Weekday lunch traffic')
  })

  it('keeps the why to at most two rationale statements', () => {
    const { blocks } = buildRecommendationPresentation('rec1', draft())
    const block = blocks[1]
    if (block?.type !== 'marketing_recommendation') throw new Error('expected recommendation block')

    expect(block.why).toContain('Your menu lists lunch meals.')
    expect(block.why).toContain('Office workers may be nearby.')
    expect(block.why).not.toContain('A third reason.')
  })

  it('falls back to the diagnosis when there is no rationale', () => {
    const { blocks } = buildRecommendationPresentation('rec1', draft({ rationale: [] }))
    const block = blocks[1]
    if (block?.type !== 'marketing_recommendation') throw new Error('expected recommendation block')

    expect(block.why).toBe('Weekday demand appears low.')
  })

  it('carries the audience and offer provenance through to the card', () => {
    const { blocks } = buildRecommendationPresentation('rec1', draft())
    const block = blocks[1]
    if (block?.type !== 'marketing_recommendation') throw new Error('expected recommendation block')

    expect(block.audience?.basis).toBe('hypothesis')
    expect(block.offer?.basis).toBe('recommendation')
  })
})
