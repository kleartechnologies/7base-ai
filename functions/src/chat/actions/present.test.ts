import { describe, expect, it } from 'vitest'

import { buildStoredCreative, type StoredCreative } from '../../creative/store'
import { FALLBACK_COPY_NOTE } from '../../creative/present'
import type { ActionProposalBlock, CreativeSetBlock } from '../../lib/types'
import {
  confirmLabelFor,
  detectReplyLanguage,
  presentCreativeSetOutcome,
  presentProposal,
  retryLabelFor,
  type CreativeSetOutcome,
} from './present'

/**
 * What the owner reads after an action: the exact honest sentences the spec
 * requires ("Done — I created 3 posters.", "I created 2 of the 3 posters.
 * One couldn’t be completed."), never a model, a token, a task id or a cost.
 */

function makeCreative(overrides: Partial<StoredCreative> = {}): StoredCreative {
  return {
    ...buildStoredCreative({
      ownerId: 'user1',
      businessId: 'biz1',
      campaignId: 'camp1',
      conversationId: 'conv1',
      sourceRecommendationId: 'rec1',
      name: 'Launch Poster',
      format: 'square_post',
      content: {
        headline: 'Maths made simple',
        subheadline: null,
        body: null,
        callToAction: 'Download the app',
        offerText: null,
        image: {
          storagePath: 'businesses/biz1/creatives/x.png',
          prompt: 'p',
          altText: 'alt',
          source: 'generated',
        },
        layout: 'image_full_bleed',
      },
      captions: { facebook: null, instagram: null, short: null, whatsapp: null },
      style: { palette: [], headingFont: null, bodyFont: null, logoStoragePath: null },
      assetIds: [],
      imageError: null,
      meta: { model: 'gpt-secret', task: 'creative.generate_copy', latencyMs: 9, usage: null },
      now: 1,
    }),
    ...overrides,
  }
}

function outcomeOf(overrides: Partial<CreativeSetOutcome> = {}): CreativeSetOutcome {
  return {
    campaignId: 'camp1',
    campaignName: 'Matheasy Launch',
    requested: [1, 2, 3],
    size: 3,
    format: 'square_post',
    brief: 'the plan',
    created: [1, 2, 3].map((position) => ({
      position,
      creativeId: `cr${position}`,
      creative: makeCreative({ name: `Poster ${position}` }),
      copyFellBack: false,
    })),
    failed: [],
    blockedMessage: null,
    campaignCreated: null,
    ...overrides,
  }
}

describe('presentCreativeSetOutcome', () => {
  it('says exactly what was created and shows the set', () => {
    const { blocks, plainText } = presentCreativeSetOutcome(outcomeOf(), 'en')
    expect(plainText.startsWith('Done — I created 3 posters for “Matheasy Launch”.')).toBe(true)
    expect(blocks.map((b) => b.type)).toEqual(['text', 'creative_set'])
    const set = blocks[1] as CreativeSetBlock
    expect(set.items.map((i) => i.name)).toEqual(['Poster 1', 'Poster 2', 'Poster 3'])
    expect(set.items[0]?.image?.storagePath).toBe('businesses/biz1/creatives/x.png')
    // Nothing internal reaches the owner.
    expect(JSON.stringify(blocks)).not.toContain('gpt-secret')
    expect(plainText).not.toMatch(/token|model|quota|cost/i)
  })

  it('states a partial result in the spec’s words and offers only the missing poster, to the same plan', () => {
    const outcome = outcomeOf({
      created: [1, 2].map((position) => ({
        position,
        creativeId: `cr${position}`,
        creative: makeCreative(),
        copyFellBack: false,
      })),
      failed: [3],
    })
    const { blocks, plainText } = presentCreativeSetOutcome(outcome, 'en')
    expect(plainText).toContain('I created 2 of the 3 posters. One couldn’t be completed.')
    const proposal = blocks.at(-1) as ActionProposalBlock
    expect(proposal.type).toBe('action_proposal')
    expect(proposal.confirmLabel).toBe('Try the third one again')
    expect(proposal.action).toEqual({
      kind: 'creative.generate',
      campaignId: 'camp1',
      campaignName: 'Matheasy Launch',
      spec: { format: 'square_post', brief: 'the plan', positions: [3], size: 3 },
    })
  })

  it('does not offer a retry against a daily limit, and repeats the limit sentence', () => {
    const limit = "You've reached today's AI request limit. Please try again tomorrow."
    const outcome = outcomeOf({
      created: [
        { position: 1, creativeId: 'cr1', creative: makeCreative(), copyFellBack: false },
      ],
      failed: [2, 3],
      blockedMessage: limit,
    })
    const { blocks, plainText } = presentCreativeSetOutcome(outcome, 'en')
    expect(plainText).toContain('I created 1 of the 3 posters. 2 couldn’t be completed.')
    expect(plainText).toContain(limit)
    expect(blocks.some((b) => b.type === 'action_proposal')).toBe(false)
  })

  it('a total failure is said plainly, with the retry offered', () => {
    const { blocks, plainText } = presentCreativeSetOutcome(
      outcomeOf({ created: [], failed: [1, 2, 3] }),
      'en',
    )
    expect(plainText).toBe('I couldn’t create the posters just now.')
    expect(blocks.map((b) => b.type)).toEqual(['text', 'action_proposal'])
    expect((blocks[1] as ActionProposalBlock).confirmLabel).toBe('Try the missing ones again')
  })

  it('mentions image failures and fallback copy honestly', () => {
    const outcome = outcomeOf({
      created: [
        {
          position: 1,
          creativeId: 'cr1',
          creative: makeCreative({ imageError: 'The poster image could not be created.' }),
          copyFellBack: true,
        },
        { position: 2, creativeId: 'cr2', creative: makeCreative(), copyFellBack: false },
      ],
      requested: [1, 2],
      size: 2,
    })
    const { plainText } = presentCreativeSetOutcome(outcome, 'en')
    expect(plainText).toContain('The image for 1 of them couldn’t be created')
    expect(plainText).toContain(FALLBACK_COPY_NOTE)
  })

  it('a single requested poster keeps the existing creative presentation', () => {
    const { blocks } = presentCreativeSetOutcome(
      outcomeOf({
        requested: [1],
        size: 1,
        created: [{ position: 1, creativeId: 'cr1', creative: makeCreative(), copyFellBack: false }],
      }),
      'en',
    )
    expect(blocks.some((b) => b.type === 'creative_preview')).toBe(true)
    expect(blocks.some((b) => b.type === 'creative_set')).toBe(false)
  })

  it('leads with the campaign it created and shows the card above the set', () => {
    const campaign = {
      ownerId: 'user1',
      businessId: 'biz1',
      conversationId: 'conv1',
      sourceRecommendationId: 'rec1',
      name: 'App Launch Push',
      status: 'draft' as const,
      objective: 'o',
      targetAudience: null,
      offer: null,
      positioning: null,
      keyMessage: 'k',
      callToAction: 'c',
      channels: [],
      durationDays: null,
      startDate: null,
      endDate: null,
      notes: null,
      assumptions: [],
      unknowns: [],
      userEdited: [],
      meta: null,
      createdAt: 1,
      updatedAt: 1,
    }
    const { blocks, plainText } = presentCreativeSetOutcome(
      outcomeOf({ campaignCreated: { campaignId: 'camp9', campaign } }),
      'en',
    )
    expect(plainText.startsWith('I created a campaign for this: “App Launch Push”. Done — I created 3 posters')).toBe(true)
    expect(blocks.map((b) => b.type)).toEqual(['text', 'campaign_card', 'creative_set'])
  })

  it('speaks Bahasa Melayu when asked to', () => {
    const { plainText } = presentCreativeSetOutcome(outcomeOf(), 'ms')
    expect(plainText.startsWith('Siap — saya dah buat 3 poster untuk “Matheasy Launch”.')).toBe(true)
  })
})

describe('proposals', () => {
  const three = {
    kind: 'creative.generate' as const,
    campaignId: 'camp1',
    campaignName: 'Matheasy Launch',
    spec: { format: 'square_post' as const, brief: null, positions: [1, 2, 3], size: 3 },
  }

  it('uses the empty-state sentence from the spec', () => {
    const { plainText, blocks } = presentProposal(
      { kind: 'campaign.create', goal: 'g', then: null },
      'en',
      { kind: 'no_campaign' },
    )
    expect(plainText).toBe('You don’t have a campaign for this yet. I can create one for you. Want me to go ahead?')
    expect((blocks[1] as ActionProposalBlock).confirmLabel).toBe('Yes, create the campaign')
  })

  it('labels the go-ahead with the number, and retries by position', () => {
    expect(confirmLabelFor(three, 'en')).toBe('Yes, create the 3 posters')
    expect(confirmLabelFor({ ...three, spec: { ...three.spec, positions: [1], size: 1 } }, 'en')).toBe('Yes, create it')
    expect(confirmLabelFor(three, 'ms')).toBe('Ya, buat 3 poster')
    expect(retryLabelFor([2], 'en')).toBe('Try the second one again')
    expect(retryLabelFor([2, 3], 'ms')).toBe('Cuba yang tinggal sekali lagi')
  })

  it('a repeated identical request points at what exists and offers another set', () => {
    const { plainText } = presentProposal(three, 'en', { kind: 'repeat' })
    expect(plainText).toBe('I just created those — they’re above. Want another set?')
  })
})

describe('detectReplyLanguage', () => {
  it('follows the message when it is unmistakably one language, else the saved preference', () => {
    expect(detectReplyLanguage('okay go design', 'ms')).toBe('en')
    expect(detectReplyLanguage('ya, teruskan', 'en')).toBe('ms')
    expect(detectReplyLanguage('👍', 'ms')).toBe('ms')
    expect(detectReplyLanguage('👍', 'en')).toBe('en')
  })
})
