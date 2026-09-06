import { describe, expect, it } from 'vitest'

import type { StoredCampaign } from '../campaign/store'
import {
  buildCopyInput,
  buildImagePrompt,
  CREATIVE_COPY_PROMPT,
  CREATIVE_EDIT_PROMPT,
} from './prompt'

/**
 * The prompts are policy. These tests pin the clauses the product depends
 * on: never inventing facts, owner rules outranking everything, and the
 * image carrying no text so wording edits never cost a regeneration.
 */

const campaign: StoredCampaign = {
  name: 'Weekday Lunch Growth',
  objective: 'Increase weekday lunch customers',
  targetAudience: { description: 'Nearby office workers', basis: 'known' },
  offer: { description: 'Consider a weekday lunch set', basis: 'recommendation' },
  positioning: null,
  keyMessage: 'Lunch without the wait',
  callToAction: 'Order on WhatsApp',
  channels: ['instagram', 'whatsapp'],
  durationDays: 14,
  startDate: null,
  endDate: null,
  notes: null,
  assumptions: [],
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

describe('CREATIVE_COPY_PROMPT', () => {
  it('forbids invented facts and puts owner rules above everything', () => {
    expect(CREATIVE_COPY_PROMPT).toContain('Never invent facts')
    expect(CREATIVE_COPY_PROMPT).toContain('OWNER RULES')
    expect(CREATIVE_COPY_PROMPT).toContain('outrank')
  })

  it('keeps words out of the image brief', () => {
    expect(CREATIVE_COPY_PROMPT).toContain('Describe things, never words')
  })
})

describe('buildCopyInput', () => {
  it('carries the campaign strategy and marks the unknowns as off-limits', () => {
    const input = buildCopyInput({
      businessName: 'Secret Recipe Kopitiam',
      brandVoice: null,
      brandStyle: null,
      campaign,
      format: 'square_post',
      directives: [],
      hasRealImage: false,
    })
    expect(input).toContain('BUSINESS: Secret Recipe Kopitiam')
    expect(input).toContain('OFFER (recommendation): Consider a weekday lunch set')
    expect(input).toContain('CORE MESSAGE: Lunch without the wait')
    expect(input).toContain('STILL UNKNOWN (do not invent values for these): Pricing not confirmed')
    expect(input).not.toContain('OWNER RULES')
  })

  it('lists owner rules when there are standing directives', () => {
    const input = buildCopyInput({
      businessName: null,
      brandVoice: null,
      brandStyle: null,
      campaign,
      format: 'portrait_post',
      directives: ["Don't mention discounts"],
      hasRealImage: true,
    })
    expect(input).toContain("- Don't mention discounts")
    expect(input).toContain('a real photo from the business will be used')
    expect(input).toContain('portrait social post')
  })
})

describe('CREATIVE_EDIT_PROMPT', () => {
  it('demands a minimal patch and protects owner-set fields', () => {
    expect(CREATIVE_EDIT_PROMPT).toContain('null means "leave it exactly as it is"')
    expect(CREATIVE_EDIT_PROMPT).toContain('OWNER-SET')
  })

  it('reserves visualChange for actual image changes — wording is never one', () => {
    expect(CREATIVE_EDIT_PROMPT).toContain('Wording changes are never a visualChange')
    expect(CREATIVE_EDIT_PROMPT).toContain('regenerating the image costs the owner money')
  })

  it("lets the owner's own typed price through", () => {
    expect(CREATIVE_EDIT_PROMPT).toContain(
      'A price the owner types in the instruction is theirs to use',
    )
  })
})

describe('buildImagePrompt', () => {
  it('ends with the no-text clause, always', () => {
    const prompt = buildImagePrompt({
      brief: 'A plate of nasi lemak on a kopitiam table',
      format: 'square_post',
      paletteHexes: [],
      visualStyle: null,
    })
    expect(prompt).toContain('A plate of nasi lemak')
    expect(
      prompt.endsWith(
        'Strictly no text, no words, no letters, no numbers, no signage, no watermarks, no logos, no brand marks anywhere in the image.',
      ),
    ).toBe(true)
  })

  it('weaves in format and brand palette when present', () => {
    const prompt = buildImagePrompt({
      brief: 'A laksa bowl, steam rising',
      format: 'portrait_post',
      paletteHexes: ['#C2410C', '#F59E0B'],
      visualStyle: 'warm and rustic',
    })
    expect(prompt).toContain('portrait')
    expect(prompt).toContain('#C2410C, #F59E0B')
    expect(prompt).toContain('Visual style: warm and rustic.')
  })
})
