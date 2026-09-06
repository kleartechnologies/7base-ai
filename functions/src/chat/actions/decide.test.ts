import { describe, expect, it } from 'vitest'

import type { ActionProposalBlock, ProposedAction, StoredMessage } from '../../lib/types'
import {
  decideChatAction,
  detectAssistantOffer,
  extractOfferBrief,
  parseCreativeRequest,
  readAffirmation,
  readChoice,
  readCount,
} from './decide'

/**
 * Phase 7F — the action decision. The one bug this phase exists for: EVA
 * proposed three posters, the owner said "okay go design", and nothing
 * happened. Every case here is deterministic — no model, no Firestore.
 */

const THREE_POSTERS: ProposedAction = {
  kind: 'creative.generate',
  campaignId: 'camp1',
  campaignName: 'Matheasy launch',
  spec: {
    format: 'square_post',
    brief: 'design 3 posters: 1. English intro, 2. BM step-by-step, 3. Numi AI tutor',
    positions: [1, 2, 3],
    size: 3,
  },
}

function assistantTurn(action: ProposedAction | null): Pick<StoredMessage, 'role' | 'blocks'> {
  const blocks: StoredMessage['blocks'] = [
    { id: 'b0', type: 'text', text: 'I can design the 3 posters. Want me to go ahead?' },
  ]
  if (action) {
    const proposal: ActionProposalBlock = {
      id: 'b1',
      type: 'action_proposal',
      action,
      confirmLabel: 'Yes, create them',
    }
    blocks.push(proposal)
  }
  return { role: 'assistant', blocks }
}

describe('the exact production bug (§20)', () => {
  it('"okay go design" after a 3-poster proposal executes that proposal unchanged', () => {
    const decision = decideChatAction({
      text: 'okay go design',
      previousAssistant: assistantTurn(THREE_POSTERS),
    })
    expect(decision).toEqual({ type: 'confirm', action: THREE_POSTERS })
  })

  it('carries the campaign, count, format and brief of the proposal — nothing is re-parsed from the yes', () => {
    const decision = decideChatAction({
      text: 'okay go design',
      previousAssistant: assistantTurn(THREE_POSTERS),
    })
    if (decision.type !== 'confirm' || decision.action.kind !== 'creative.generate') {
      throw new Error('expected a creative.generate confirmation')
    }
    expect(decision.action.campaignId).toBe('camp1')
    expect(decision.action.spec.positions).toEqual([1, 2, 3])
    expect(decision.action.spec.format).toBe('square_post')
    expect(decision.action.spec.brief).toContain('Numi AI tutor')
  })
})

describe('natural-language go-aheads (§21)', () => {
  const variations = [
    'okay go design',
    'go ahead',
    'yes, make them',
    'do it',
    'create them',
    "let's do it",
    'make the posters',
    'yes go ahead',
    'Okay!',
    'ya boleh',
    'jom',
    'teruskan',
    'buatkan',
    'ok proceed',
    'sure, go for it 👍',
    'yes please create all three',
  ]
  for (const text of variations) {
    it(`"${text}" confirms the pending proposal`, () => {
      const decision = decideChatAction({ text, previousAssistant: assistantTurn(THREE_POSTERS) })
      expect(decision.type).toBe('confirm')
    })
  }

  it('a go-ahead with a different number adjusts the count without re-asking', () => {
    const decision = decideChatAction({
      text: 'ok but just make 2',
      previousAssistant: assistantTurn(THREE_POSTERS),
    })
    if (decision.type !== 'confirm' || decision.action.kind !== 'creative.generate') {
      throw new Error('expected confirmation')
    }
    expect(decision.action.spec.positions).toEqual([1, 2])
    expect(decision.action.spec.size).toBe(2)
  })

  it('a go-ahead never fires without structured state: the same words with no proposal do nothing', () => {
    for (const text of ['okay go design', 'go ahead', 'do it', 'yes']) {
      expect(decideChatAction({ text, previousAssistant: assistantTurn(null) })).toEqual({
        type: 'none',
      })
      expect(decideChatAction({ text, previousAssistant: null })).toEqual({ type: 'none' })
    }
  })

  it('only the turn directly before the message can carry the pending proposal', () => {
    // The caller passes null when the previous message was the owner's own
    // (or anything but an assistant turn): a proposal two turns back is inert.
    expect(
      decideChatAction({ text: 'ok go', previousAssistant: { role: 'user', blocks: [] } }),
    ).toEqual({ type: 'none' })
  })

  it('a decline lets the proposal lapse into conversation', () => {
    for (const text of ['no', 'not now', 'wait, not yet', 'jangan dulu', 'hold on', 'cancel that']) {
      expect(
        decideChatAction({ text, previousAssistant: assistantTurn(THREE_POSTERS) }),
      ).toEqual({ type: 'none' })
    }
  })

  it('a yes with substance of its own is a conversation, not a go-ahead', () => {
    expect(readAffirmation('yes but use blue instead of green')).toBe('other')
    expect(readAffirmation('ok, and what about the pricing for the second one?')).toBe('other')
    expect(readAffirmation('okay go design')).toBe('yes')
  })
})

describe('messages that must stay conversational (§22)', () => {
  const informational = [
    'What should I post this weekend?',
    'Do you think green works for my brand?',
    'Tell me about my target customers.',
    'How do I make a poster look premium?',
    'Which poster format works best on Instagram?',
    'Should I create posters for Merdeka?',
    'Apa yang patut saya post minggu ni?',
  ]
  for (const text of informational) {
    it(`"${text}" is not an action even with a proposal pending`, () => {
      expect(decideChatAction({ text, previousAssistant: assistantTurn(THREE_POSTERS) })).toEqual({
        type: 'none',
      })
      expect(decideChatAction({ text, previousAssistant: null })).toEqual({ type: 'none' })
    })
  }

  it('an edit of an existing poster is left to the edit route', () => {
    expect(parseCreativeRequest('make the poster more premium')).toBeNull()
    expect(parseCreativeRequest('rewrite the poster headline')).toBeNull()
    expect(parseCreativeRequest("don't create the posters yet")).toBeNull()
  })
})

describe('explicit requests', () => {
  it('"Create 3 posters" is a request for three square posters', () => {
    const spec = parseCreativeRequest('Create 3 posters for the weekend promo')
    expect(spec).not.toBeNull()
    expect(spec?.positions).toEqual([1, 2, 3])
    expect(spec?.size).toBe(3)
    expect(spec?.format).toBe('square_post')
    expect(spec?.brief).toBe('Create 3 posters for the weekend promo')
  })

  it('reads counts in words, in Malay, and after the noun', () => {
    expect(readCount('design three posters')).toBe(3)
    expect(readCount('buat dua poster untuk promosi')).toBe(2)
    expect(readCount('tolong buatkan poster tiga keping')).toBe(3)
    expect(readCount('make a poster')).toBe(1)
    expect(readCount('design 3 square 1080x1080 posters')).toBe(3)
    expect(readCount('make posters at 1080x1080')).toBe(1)
  })

  it('caps a set at the per-request maximum', () => {
    const spec = parseCreativeRequest('create 10 posters')
    expect(spec?.positions).toEqual([1, 2, 3])
  })

  it('reads the format', () => {
    expect(parseCreativeRequest('make a portrait poster for stories')?.format).toBe('portrait_post')
    expect(parseCreativeRequest('design a 1080x1080 poster')?.format).toBe('square_post')
  })

  it('a "new/another" marker turns an edit-shaped sentence into a request', () => {
    expect(parseCreativeRequest('make another poster for the lunch set')).not.toBeNull()
    expect(parseCreativeRequest('make 2 more posters')).not.toBeNull()
  })

  it('a request is executed even when a proposal is pending, if it is not a plain yes', () => {
    const decision = decideChatAction({
      text: 'actually create 1 portrait poster about the free trial',
      previousAssistant: assistantTurn(THREE_POSTERS),
    })
    expect(decision.type).toBe('creative_request')
  })
})

describe('choosing a campaign', () => {
  const choose: ProposedAction = {
    kind: 'campaign.choose',
    choices: [
      { campaignId: 'c1', name: 'Weekday Lunch Push' },
      { campaignId: 'c2', name: 'Merdeka Special' },
    ],
    then: THREE_POSTERS.spec,
  }

  it('resolves by number, ordinal and name', () => {
    expect(readChoice('2', choose.choices)).toBe(1)
    expect(readChoice('the first one', choose.choices)).toBe(0)
    expect(readChoice('yang kedua', choose.choices)).toBe(1)
    expect(readChoice('Use the campaign: Merdeka Special', choose.choices)).toBe(1)
    expect(readChoice('merdeka', choose.choices)).toBeNull()
  })

  it('a choice becomes the creative action for that campaign', () => {
    const decision = decideChatAction({ text: 'the second one', previousAssistant: assistantTurn(choose) })
    expect(decision).toEqual({
      type: 'choose',
      action: {
        kind: 'creative.generate',
        campaignId: 'c2',
        campaignName: 'Merdeka Special',
        spec: THREE_POSTERS.spec,
      },
    })
  })

  it('a bare yes on a choice asks again instead of guessing', () => {
    const decision = decideChatAction({ text: 'yes', previousAssistant: assistantTurn(choose) })
    expect(decision.type).toBe('reask_choice')
  })
})

describe("EVA's own offers", () => {
  it('detects an offer to create posters and reads the count from it', () => {
    expect(
      detectAssistantOffer(
        "I'll design the 3 posters using your uploaded app screenshots and Matheasy's green branding. Shall I go ahead?",
      ),
    ).toEqual({ count: 3, explicit: true, format: 'square_post' })
    expect(detectAssistantOffer('Want me to create a poster for that?')).toEqual({
      count: 1,
      explicit: true,
      format: 'square_post',
    })
    expect(detectAssistantOffer('Saya boleh buatkan dua poster untuk promosi ini.')).toEqual({
      count: 2,
      explicit: true,
      format: 'square_post',
    })
    expect(detectAssistantOffer('Want me to go ahead and create the posters?')).toEqual({
      count: 1,
      explicit: false,
      format: 'square_post',
    })
  })

  it('ignores replies that merely talk about posters', () => {
    expect(detectAssistantOffer('Green works well for a maths brand; a poster in that green would feel calm.')).toBeNull()
    expect(detectAssistantOffer('Your target customers are parents of primary-school children.')).toBeNull()
  })
})

describe('detectAssistantOffer — negations and briefs', () => {
  it('does not read a stated limit as an offer', () => {
    expect(detectAssistantOffer("I can't create posters from here yet, but I can suggest a design.")).toBeNull()
    expect(detectAssistantOffer('Saya tidak boleh buat poster buat masa ini.')).toBeNull()
  })

  it('keeps the numbered plan as the brief and drops markdown bold', () => {
    const reply = [
      "I'll design the 3 posters using your screenshots and Matheasy's green **#22c55e** branding:",
      '1. **English — Introduction**',
      '2. Bahasa Melayu — Step-by-step learning',
      '3. English — Numi AI Tutor',
      'Shall I go ahead?',
    ].join('\n')
    expect(extractOfferBrief(reply)).toBe(
      '1. English — Introduction\n2. Bahasa Melayu — Step-by-step learning\n3. English — Numi AI Tutor',
    )
    expect(extractOfferBrief('Want me to create a poster for that?')).toBe(
      'Want me to create a poster for that?',
    )
    expect(extractOfferBrief('   ')).toBeNull()
  })
})
