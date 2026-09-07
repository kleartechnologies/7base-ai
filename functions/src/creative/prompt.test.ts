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
      direction: 'hero_product',
      paletteHexes: [],
      visualStyle: null,
      businessType: null,
    })
    expect(prompt).toContain('A plate of nasi lemak')
    expect(
      prompt.endsWith(
        'Strictly no text of any kind: no words, letters, numbers, captions, labels, signage, packaging copy, watermarks, logos or brand marks anywhere in the image.',
      ),
    ).toBe(true)
  })

  it('weaves in format, business type and brand palette when present', () => {
    const prompt = buildImagePrompt({
      brief: 'A laksa bowl, steam rising',
      format: 'portrait_post',
      direction: 'clean_editorial',
      paletteHexes: ['#C2410C', '#F59E0B'],
      visualStyle: 'warm and rustic',
      businessType: 'a kopitiam in Ipoh',
    })
    expect(prompt).toContain('portrait 4:5')
    expect(prompt).toContain('a kopitiam in Ipoh')
    expect(prompt).toContain('#C2410C, #F59E0B')
    expect(prompt).toContain('Visual style: warm and rustic.')
    // The brand colour accents the frame; it never becomes the frame.
    expect(prompt).toContain('Never flood the frame with them')
  })

  it('art-directs each creative direction differently, and never as a template', () => {
    const at = (direction: Parameters<typeof buildImagePrompt>[0]['direction']) =>
      buildImagePrompt({
        brief: 'the same brief',
        format: 'square_post',
        direction,
        paletteHexes: [],
        visualStyle: null,
        businessType: null,
      })
    const promo = at('bold_promotional')
    const minimal = at('minimal_premium')
    const app = at('app_showcase')
    expect(new Set([promo, minimal, app]).size).toBe(3)
    // Each brief reserves the space its own poster layout draws over.
    expect(promo).toContain('bottom third')
    expect(minimal).toContain('genuinely empty negative space')
    expect(app).toContain('never readable interface text')
    // The quality bar is stated for every direction, not just some.
    for (const prompt of [promo, minimal, app]) {
      expect(prompt).toContain('one clear focal point')
      expect(prompt).toContain('no template look')
      // §7 honesty: the renderer draws the panel, the type and the real
      // logo. A brief that says "a panel goes here" gets one painted in,
      // and the poster then carries two in two different colours.
      expect(prompt).toContain('This is a photograph, not a finished poster')
      expect(prompt).not.toMatch(/is laid over it|is set over it|inset card|type beneath/)
    }
  })
})
