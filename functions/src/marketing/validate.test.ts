import { describe, expect, it } from 'vitest'

import {
  RecommendationValidationError,
  recommendedOpportunity,
  validateMarketingRecommendation,
} from './validate'

/**
 * The validator's job is honesty under pressure: whatever the model mangles,
 * nothing may come out of here claiming more certainty than went in. Missing
 * essentials fail the recommendation; everything else coerces *downward* —
 * to 'low', to 'hypothesis', to 'unknown', to null — never upward.
 */

function validRaw(): Record<string, unknown> {
  return {
    ownerSummary: 'Weekday lunch looks like your best opening.',
    goal: 'Increase weekday customers',
    diagnosis: {
      statement: 'Weekday demand appears lower than weekend demand.',
      basis: 'hypothesis',
    },
    opportunities: [
      {
        title: 'Weekday lunch traffic',
        description: 'Promote lunch sets to nearby workers.',
        evidence: ['The menu lists lunch meals'],
        assumptions: ['Weekday lunch is quieter than weekends'],
        potentialImpact: 'high_potential',
        effort: 'medium',
        suitability: 'The menu already fits a lunch offer.',
      },
      {
        title: 'Weekend family dining',
        description: 'Push sharing platters for families.',
        evidence: [],
        assumptions: [],
        potentialImpact: 'moderate_potential',
        effort: 'low',
        suitability: null,
      },
    ],
    recommendedIndex: 0,
    rationale: [
      { statement: 'Your menu lists lunch meals.', kind: 'fact', basedOn: 'products' },
      {
        statement: 'Nearby office workers may be an important audience.',
        kind: 'inference',
        basedOn: 'location',
      },
    ],
    targetAudience: { description: 'Nearby working adults', basis: 'hypothesis' },
    offer: { description: 'Consider a weekday lunch set', basis: 'recommendation' },
    positioning: 'Affordable weekday comfort lunch',
    coreMessage: 'Your weekday lunch, sorted.',
    callToAction: 'Visit us for lunch',
    channels: ['instagram', 'facebook'],
    durationDays: 14,
    confidence: 'medium',
    confidenceReason: 'Based only on website information.',
    assumptions: ['Weekday lunch demand is lower than weekend demand.'],
    unknowns: ['Actual sales by day of week'],
    nextAction: 'build_campaign',
  }
}

describe('a valid recommendation', () => {
  it('passes through intact', () => {
    const draft = validateMarketingRecommendation(validRaw())

    expect(draft.goal).toBe('Increase weekday customers')
    expect(draft.opportunities).toHaveLength(2)
    expect(draft.recommendedIndex).toBe(0)
    expect(recommendedOpportunity(draft).title).toBe('Weekday lunch traffic')
    expect(draft.rationale[0]).toEqual({
      statement: 'Your menu lists lunch meals.',
      kind: 'fact',
      basedOn: 'products',
    })
    expect(draft.targetAudience).toEqual({
      description: 'Nearby working adults',
      basis: 'hypothesis',
    })
    expect(draft.offer?.basis).toBe('recommendation')
    expect(draft.channels).toEqual(['instagram', 'facebook'])
    expect(draft.durationDays).toBe(14)
    expect(draft.confidence).toBe('medium')
    expect(draft.nextAction).toBe('build_campaign')
  })
})

describe('optional fields may be absent', () => {
  it('accepts a recommendation that admits what it does not have', () => {
    const raw = {
      ...validRaw(),
      targetAudience: { description: null, basis: 'hypothesis' },
      offer: { description: null, basis: 'recommendation' },
      positioning: null,
      coreMessage: null,
      callToAction: null,
      channels: [],
      durationDays: null,
      confidenceReason: null,
      assumptions: [],
      unknowns: [],
    }

    const draft = validateMarketingRecommendation(raw)

    expect(draft.targetAudience).toBeNull()
    expect(draft.offer).toBeNull()
    expect(draft.positioning).toBeNull()
    expect(draft.durationDays).toBeNull()
    expect(draft.channels).toEqual([])
  })
})

describe('essentials cannot be missing', () => {
  it('rejects a non-object', () => {
    expect(() => validateMarketingRecommendation('a plan')).toThrow(RecommendationValidationError)
    expect(() => validateMarketingRecommendation(null)).toThrow(RecommendationValidationError)
  })

  it('rejects a missing goal', () => {
    expect(() => validateMarketingRecommendation({ ...validRaw(), goal: '' })).toThrow(
      RecommendationValidationError,
    )
  })

  it('rejects a missing owner summary', () => {
    expect(() =>
      validateMarketingRecommendation({ ...validRaw(), ownerSummary: null }),
    ).toThrow(RecommendationValidationError)
  })

  it('rejects a missing diagnosis', () => {
    expect(() => validateMarketingRecommendation({ ...validRaw(), diagnosis: {} })).toThrow(
      RecommendationValidationError,
    )
  })

  it('rejects a recommendation with no usable opportunities', () => {
    expect(() => validateMarketingRecommendation({ ...validRaw(), opportunities: [] })).toThrow(
      RecommendationValidationError,
    )
    expect(() =>
      validateMarketingRecommendation({
        ...validRaw(),
        opportunities: [{ title: '', description: '' }],
      }),
    ).toThrow(RecommendationValidationError)
  })
})

describe('mangled claims coerce downward, never upward', () => {
  it('an invented confidence value becomes low', () => {
    const draft = validateMarketingRecommendation({ ...validRaw(), confidence: 'certain' })
    expect(draft.confidence).toBe('low')
  })

  it('a mangled diagnosis basis stays a hypothesis', () => {
    const raw = validRaw()
    raw.diagnosis = { statement: 'Weekdays look slow.', basis: 'definitely-true' }
    expect(validateMarketingRecommendation(raw).diagnosis.basis).toBe('hypothesis')
  })

  it('an audience is only known when claimed exactly', () => {
    const raw = validRaw()
    raw.targetAudience = { description: 'Everyone nearby', basis: 'obviously' }
    expect(validateMarketingRecommendation(raw).targetAudience?.basis).toBe('hypothesis')
  })

  it('an offer is only existing when claimed exactly', () => {
    const raw = validRaw()
    raw.offer = { description: 'RM29.90 lunch set', basis: 'verified' }
    expect(validateMarketingRecommendation(raw).offer?.basis).toBe('recommendation')
  })

  it('an unknown rationale kind becomes a recommendation, not a fact', () => {
    const raw = validRaw()
    raw.rationale = [{ statement: 'Lunch is your opening.', kind: 'truth', basedOn: 'products' }]
    expect(validateMarketingRecommendation(raw).rationale[0]?.kind).toBe('recommendation')
  })

  it('an invented rationale source becomes null', () => {
    const raw = validRaw()
    raw.rationale = [{ statement: 'Lunch is your opening.', kind: 'fact', basedOn: 'sales_data' }]
    expect(validateMarketingRecommendation(raw).rationale[0]?.basedOn).toBeNull()
  })

  it('a mangled impact becomes unknown, never a number', () => {
    const raw = validRaw()
    const opportunities = raw.opportunities as Record<string, unknown>[]
    opportunities[0]!.potentialImpact = '37% uplift'
    expect(validateMarketingRecommendation(raw).opportunities[0]?.potentialImpact).toBe('unknown')
  })

  it('an out-of-range recommended index falls back to the first opportunity', () => {
    const draft = validateMarketingRecommendation({ ...validRaw(), recommendedIndex: 7 })
    expect(draft.recommendedIndex).toBe(0)
  })

  it('unknown channels are dropped and duplicates collapse', () => {
    const raw = { ...validRaw(), channels: ['instagram', 'Instagram', 'billboards', 'in_store'] }
    expect(validateMarketingRecommendation(raw).channels).toEqual(['instagram', 'in_store'])
  })

  it('an absurd duration becomes null rather than advice', () => {
    expect(
      validateMarketingRecommendation({ ...validRaw(), durationDays: 400 }).durationDays,
    ).toBeNull()
    expect(
      validateMarketingRecommendation({ ...validRaw(), durationDays: 0 }).durationDays,
    ).toBeNull()
  })

  it('a mangled next action defaults to build_campaign', () => {
    expect(
      validateMarketingRecommendation({ ...validRaw(), nextAction: 'publish_now' }).nextAction,
    ).toBe('build_campaign')
  })
})

describe('unknown handling', () => {
  it('keeps the unknowns list, deduplicated', () => {
    const raw = {
      ...validRaw(),
      unknowns: ['Best-selling product', 'best-selling product', 'Customer demographics'],
    }
    expect(validateMarketingRecommendation(raw).unknowns).toEqual([
      'Best-selling product',
      'Customer demographics',
    ])
  })

  it('drops "unknown" placeholders that answer the prompt instead of the field', () => {
    const draft = validateMarketingRecommendation({ ...validRaw(), positioning: 'N/A' })
    expect(draft.positioning).toBeNull()
  })
})
