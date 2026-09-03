import { describe, expect, it } from 'vitest'

import { buildBusinessContext } from '../ai/context'
import { emptyBrain } from '../business/brain/empty'
import type { Audience, Discovered } from '../lib/business.types'
import { buildMarketingInput, MARKETING_INTELLIGENCE_PROMPT } from './prompt'

/**
 * The engine's evidence base. What matters here is grounding: the goal, the
 * labelled Business Brain and a bounded slice of conversation go in — and the
 * provenance labels the Brain carries survive the trip, so a confirmed fact
 * and MARKA's own inference never reach the model looking the same.
 */

function audienceSection(confirmed: boolean, source: 'website' | 'inferred'): Discovered<Audience> {
  return {
    value: {
      summary: 'Families and office workers',
      segments: [],
      customerTypes: ['families'],
      demographics: [],
      useCases: [],
      needs: [],
      preferences: [],
    },
    source,
    sourceRef: null,
    confidence: 0.6,
    confirmed,
    discoveredAt: 1,
  }
}

describe('buildMarketingInput', () => {
  it('carries the goal and the business context', () => {
    const input = buildMarketingInput({
      goal: 'I want more customers on weekdays.',
      businessContext: '- Name: Warung Uji',
      recentTurns: [],
    })

    expect(input).toContain("THE OWNER'S REQUEST:\nI want more customers on weekdays.")
    expect(input).toContain('WHAT MARKA KNOWS ABOUT THIS BUSINESS:\n- Name: Warung Uji')
  })

  it('says plainly when almost nothing is known, instead of omitting the section', () => {
    const input = buildMarketingInput({ goal: 'More customers', businessContext: null, recentTurns: [] })
    expect(input).toContain('Almost nothing is established about this business yet')
  })

  it('keeps only the last six turns and clips long ones', () => {
    const turns = Array.from({ length: 10 }, (_, i) => ({
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      text: `turn ${i} ${'x'.repeat(400)}`,
    }))

    const input = buildMarketingInput({ goal: 'More customers', businessContext: null, recentTurns: turns })

    expect(input).not.toContain('turn 3 ')
    expect(input).toContain('turn 4 ')
    expect(input).toContain('turn 9 ')
    expect(input).toContain('…')
    expect(input).toContain('Owner: turn 4')
    expect(input).toContain('MARKA: turn 9')
  })

  it('omits the conversation section when there are no prior turns', () => {
    const input = buildMarketingInput({ goal: 'More customers', businessContext: null, recentTurns: [] })
    expect(input).not.toContain('RECENT CONVERSATION')
  })
})

describe('grounding labels survive into the engine input', () => {
  it('a confirmed section reaches the model marked as owner-confirmed fact', () => {
    const brain = emptyBrain('owner', 'Warung Uji')
    brain.audience = audienceSection(true, 'website')

    const input = buildMarketingInput({
      goal: 'More customers',
      businessContext: buildBusinessContext(brain),
      recentTurns: [],
    })

    expect(input).toContain('CONFIRMED BY THE OWNER')
  })

  it('an inferred section reaches the model marked as an unconfirmed inference', () => {
    const brain = emptyBrain('owner', 'Warung Uji')
    brain.audience = audienceSection(false, 'inferred')

    const input = buildMarketingInput({
      goal: 'More customers',
      businessContext: buildBusinessContext(brain),
      recentTurns: [],
    })

    expect(input).toContain("MARKA'S INFERENCE")
    expect(input).not.toContain('CONFIRMED BY THE OWNER')
  })

  it('what the website did not establish reaches the model as NOT KNOWN', () => {
    const brain = emptyBrain('owner', 'Warung Uji')
    brain.discovery.unknowns = ['Best-selling product']

    const input = buildMarketingInput({
      goal: 'More customers',
      businessContext: buildBusinessContext(brain),
      recentTurns: [],
    })

    expect(input).toContain('NOT KNOWN')
    expect(input).toContain('Best-selling product')
  })
})

describe('the system prompt', () => {
  it('binds the model to the three kinds of claim and to not knowing', () => {
    expect(MARKETING_INTELLIGENCE_PROMPT).toContain('FACT')
    expect(MARKETING_INTELLIGENCE_PROMPT).toContain('INFERENCE')
    expect(MARKETING_INTELLIGENCE_PROMPT).toContain('RECOMMENDATION')
    expect(MARKETING_INTELLIGENCE_PROMPT).toContain('NOT KNOWN')
    expect(MARKETING_INTELLIGENCE_PROMPT).toContain('never step-by-step reasoning')
  })
})
