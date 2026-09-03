import { describe, expect, it } from 'vitest'

import {
  detectCampaignEdit,
  detectCreativeEdit,
  detectIntent,
  mentionsCampaign,
  mentionsCampaignConcept,
  mentionsCreative,
} from './intent'

/**
 * The two costs of getting intent wrong are asymmetric but both real: a
 * greeting routed to the reasoning tier wastes a minute and real money; a
 * goal routed to small talk makes MARKA look like a chatbot. These pin the
 * phrasings the product brief promises to understand, and the ordinary chat
 * that must never trigger analysis.
 */

describe('marketing goals are recognised', () => {
  const goals = [
    'I want more customers.',
    'I want more customers on weekdays.',
    'Sales are slow on weekdays.',
    'I want to promote our new lamb shank.',
    'We need more lunch customers.',
    'I want to attract families.',
    'What should I promote this weekend?',
    'Can you help me run a promo for Merdeka?',
    'Weekends are great but weekdays are dead',
    'Any marketing ideas for the new menu?',
  ]

  for (const text of goals) {
    it(`"${text}" → marketing_goal`, () => {
      expect(detectIntent(text)).toBe('marketing_goal')
    })
  }
})

describe('Malay and Manglish goals are recognised', () => {
  // The exact phrasing the Phase 3 live smoke test showed falling through to
  // small talk, plus its close neighbours. Same heuristic, Malay vocabulary.
  const goals = [
    'nak lebih customer weekday',
    'nak ramai customer',
    'jualan weekday perlahan',
    'mahu lebih pelanggan',
    'weekday sunyi la',
    'macam mana nak ramai orang datang?',
  ]

  for (const text of goals) {
    it(`"${text}" → marketing_goal`, () => {
      expect(detectIntent(text)).toBe('marketing_goal')
    })
  }
})

describe('opportunity questions are recognised', () => {
  const goals = [
    "What's my best marketing opportunity right now?",
    'What is my best opportunity?',
    'Any growth opportunities for my cafe?',
    'What should I focus on?',
    'What should I market this month?',
    'What should I do to grow?',
    'How do I grow my business?',
  ]

  for (const text of goals) {
    it(`"${text}" → marketing_goal`, () => {
      expect(detectIntent(text)).toBe('marketing_goal')
    })
  }
})

describe('ordinary conversation stays conversation', () => {
  const chatter = [
    'Hello MARKA',
    'Thanks, that looks great!',
    'What can you do?',
    'Change my opening hours to 10am',
    'What is my website address?',
    // The two the hardening brief calls out: business questions are not goals.
    'What is my business?',
    'What are my opening hours?',
    // Malay small talk and profile edits must not trigger the engine either.
    'Terima kasih!',
    'nak tukar opening hours ke 10am',
    '',
    '   ',
  ]

  for (const text of chatter) {
    it(`"${text}" → conversation`, () => {
      expect(detectIntent(text)).toBe('conversation')
    })
  }
})

describe('follow-ups after a recommendation', () => {
  it('reads a redirection as a marketing goal when MARKA just recommended', () => {
    expect(
      detectIntent('What if I target families instead?', { afterRecommendation: true }),
    ).toBe('marketing_goal')
  })

  it('does not read the same words as a goal in ordinary conversation', () => {
    expect(detectIntent('What if I target families instead?')).toBe('conversation')
  })
})

describe('campaign edit instructions are recognised', () => {
  // The product brief's examples verbatim, plus their Malay neighbours. Once
  // a campaign exists in a conversation, these must edit it — not spawn a
  // second recommendation.
  const edits = [
    'Make this more premium.',
    "Don't use discounts.",
    'Target families instead.',
    'Change the campaign to 30 days.',
    'Make the message less formal',
    'rename the campaign to Weekday Lunch Club',
    'jangan guna diskaun',
    'tukar kempen ni jadi lebih premium',
  ]

  for (const text of edits) {
    it(`"${text}" → campaign edit`, () => {
      expect(detectCampaignEdit(text)).toBe(true)
    })
  }
})

describe('ordinary messages are not campaign edits', () => {
  const other = [
    'I want more customers on weekdays.',
    'nak tukar opening hours ke 10am',
    'What is my best-selling product?',
    'Thanks, that looks great',
  ]

  for (const text of other) {
    it(`"${text}" → not a campaign edit`, () => {
      expect(detectCampaignEdit(text)).toBe(false)
    })
  }
})

describe('mentionsCampaign gates the clarification reply', () => {
  it('sees the word campaign', () => {
    expect(mentionsCampaign('Change the campaign to 30 days.')).toBe(true)
  })

  it('sees kempen', () => {
    expect(mentionsCampaign('tukar kempen ni')).toBe(true)
  })

  it('stays quiet for generic edit phrasing', () => {
    expect(mentionsCampaign('Make this more premium.')).toBe(false)
  })
})

describe('creative edit instructions are recognised', () => {
  // The spec's own phrasings, plus the copy-specific ones the campaign
  // patterns do not catch.
  const edits = [
    'Make the headline more premium.',
    "Don't mention discounts.",
    'Change the CTA.',
    'Make the caption shorter.',
    'Rewrite the Instagram caption.',
    'Remove the hashtags.',
    'Make it punchier.',
  ]

  for (const text of edits) {
    it(`"${text}" → creative edit`, () => {
      expect(detectCreativeEdit(text)).toBe(true)
    })
  }

  it('ordinary chat is not a creative edit', () => {
    expect(detectCreativeEdit('Thanks, that looks great')).toBe(false)
    expect(detectCreativeEdit('I want more customers on weekdays.')).toBe(false)
  })
})

describe('routing between artifacts: creative nouns vs campaign concepts', () => {
  // Once a thread holds both a campaign and a creative, a generic edit lands
  // on the most recent artifact (the creative) — unless the message names a
  // campaign-only concept and no creative noun.
  it('creative nouns are recognised', () => {
    expect(mentionsCreative('Make the caption shorter.')).toBe(true)
    expect(mentionsCreative('Change the headline')).toBe(true)
    expect(mentionsCreative('a different photo please')).toBe(true)
    expect(mentionsCreative('Change the duration to 30 days.')).toBe(false)
  })

  it('campaign-only concepts are recognised', () => {
    expect(mentionsCampaignConcept('Change the duration to 30 days.')).toBe(true)
    expect(mentionsCampaignConcept('Target a different audience.')).toBe(true)
    expect(mentionsCampaignConcept('Make the headline more premium.')).toBe(false)
  })

  it('a message naming both stays with the creative', () => {
    const text = 'Change the campaign headline.'
    expect(mentionsCampaignConcept(text) && !mentionsCreative(text)).toBe(false)
  })
})
