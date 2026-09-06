import { describe, expect, it } from 'vitest'

import {
  BM_PREFERENCE_NOTE,
  buildChatSystemPrompt,
  buildPendingOfferNote,
  CURRENT_CAPABILITIES,
  EVA_IDENTITY,
} from './system'

/**
 * The capability block is the product's honesty contract: EVA must claim
 * exactly what the backend can do — creatives and images included, now that
 * they ship — and keep refusing what genuinely does not exist. These tests
 * pin both directions so the prompt cannot silently drift out of date again.
 */

describe('EVA identity', () => {
  it('presents EVA, not MARKA, as the assistant', () => {
    expect(EVA_IDENTITY).toContain('You are EVA')
    expect(buildChatSystemPrompt(null)).not.toContain('MARKA')
  })

  it('mirrors the language of the latest message: English, Bahasa Melayu and Manglish', () => {
    expect(EVA_IDENTITY).toContain('Mirror the language')
    expect(EVA_IDENTITY).toContain('Bahasa Melayu')
    expect(EVA_IDENTITY).toContain('Manglish')
    // Manglish must not be formalised away.
    expect(EVA_IDENTITY).toContain('Do not translate it into formal Bahasa Melayu')
  })

  it('asks for natural Malaysian BM, not textbook prose or Indonesian', () => {
    expect(EVA_IDENTITY).toContain('natural Malaysian Bahasa Melayu')
    expect(EVA_IDENTITY).toContain('not textbook')
    expect(EVA_IDENTITY).toContain('never Indonesian')
    // The register is anchored with a concrete example, not an adjective.
    expect(EVA_IDENTITY).toContain('Boleh. Kita boleh buat promo lunch untuk weekday.')
    // BM stays BM: the preference must not shove owners into Manglish.
    expect(EVA_IDENTITY).toContain('Do not drift into Manglish unless the owner writes Manglish')
  })
})

describe('saved-language preference', () => {
  it('appends the BM default note only when the saved preference is ms', () => {
    expect(buildChatSystemPrompt(null, { preferredLanguage: 'ms' })).toContain(BM_PREFERENCE_NOTE)
    expect(buildChatSystemPrompt(null, { preferredLanguage: 'en' })).not.toContain(
      'Language preference:',
    )
    expect(buildChatSystemPrompt(null)).not.toContain('Language preference:')
  })

  it('biases the default without overriding mirroring', () => {
    // The note is deterministic prompt text keyed off the stored preference —
    // no classifier, no extra model call — and it must defer to the latest
    // message: an owner who saved BM but types English still gets English.
    expect(BM_PREFERENCE_NOTE).toContain('no clear language of its own')
    expect(BM_PREFERENCE_NOTE).toContain(
      'A clear language in their latest message always wins over this preference.',
    )
  })

  it('keeps the prompt frame intact around the note', () => {
    const prompt = buildChatSystemPrompt('- Name: Warung Uji', { preferredLanguage: 'ms' })
    expect(prompt.startsWith(EVA_IDENTITY)).toBe(true)
    expect(prompt.endsWith(CURRENT_CAPABILITIES)).toBe(true)
    // Identity (with its mirroring rules) first, then the preference note,
    // then the brain — "the mirroring rules above" must actually be above.
    expect(prompt.indexOf(BM_PREFERENCE_NOTE)).toBeGreaterThan(prompt.indexOf(EVA_IDENTITY))
    expect(prompt.indexOf(BM_PREFERENCE_NOTE)).toBeLessThan(
      prompt.indexOf('What you know about this business:'),
    )
  })
})

describe('capability accuracy', () => {
  const prompt = buildChatSystemPrompt(null)

  it('no longer denies poster or image generation', () => {
    expect(prompt).not.toContain('cannot yet generate posters')
    expect(prompt).not.toContain('not a copywriter or a poster generator')
    expect(prompt).toContain('a poster image plus the captions')
  })

  it('routes a poster request through the campaign workflow instead of refusing', () => {
    expect(CURRENT_CAPABILITIES).toContain('do not refuse')
    expect(CURRENT_CAPABILITIES).toContain('offer to build the campaign first')
  })

  it('claims chat creative editing and asset use, which exist', () => {
    expect(CURRENT_CAPABILITIES).toContain('edit an existing poster from this chat')
    expect(CURRENT_CAPABILITIES).toContain('regenerate the image')
    expect(CURRENT_CAPABILITIES).toContain('Assets')
    expect(CURRENT_CAPABILITIES).toContain('saved to their Assets')
  })

  it('claims exactly the one page read during setup, nothing broader', () => {
    // Phase 6D: discovery can read a public Facebook Page or Instagram
    // profile the owner supplies. The claim stays that narrow — one public
    // page, at setup — and never grows into "access to their socials".
    expect(CURRENT_CAPABILITIES).toContain(
      'their website, or a public Facebook Page or Instagram profile',
    )
    expect(CURRENT_CAPABILITIES).toContain('No logging in, no private profiles')
  })

  it('still refuses honestly what does not exist: publishing, social access, billing, live results', () => {
    expect(CURRENT_CAPABILITIES).toContain('cannot publish, schedule or send anything')
    expect(CURRENT_CAPABILITIES).toContain('cannot read their social accounts')
    expect(CURRENT_CAPABILITIES).toContain('billing or payments')
    expect(CURRENT_CAPABILITIES).toContain('cannot see live sales or ad performance')
    expect(CURRENT_CAPABILITIES).toContain('cannot browse the web on demand')
  })

  it('keeps the do-not-fabricate rule', () => {
    expect(CURRENT_CAPABILITIES).toContain('Do not claim to have done anything you have not done')
  })
})

describe('buildChatSystemPrompt composition', () => {
  it('always ends with the capability block, with brain rules only when context exists', () => {
    const bare = buildChatSystemPrompt(null)
    expect(bare.startsWith(EVA_IDENTITY)).toBe(true)
    expect(bare.endsWith(CURRENT_CAPABILITIES)).toBe(true)
    expect(bare).not.toContain('Using what you know about this business')

    const withBrain = buildChatSystemPrompt('- Name: Warung Uji')
    expect(withBrain).toContain('Using what you know about this business')
    expect(withBrain).toContain('What you know about this business:\n- Name: Warung Uji')
    expect(withBrain.endsWith(CURRENT_CAPABILITIES)).toBe(true)
  })
})

describe('Phase 7F — action-first honesty', () => {
  it('tells EVA that describing a poster does not create it, and to offer with a number then wait', () => {
    expect(CURRENT_CAPABILITIES).toContain('You do not create a poster by describing it')
    expect(CURRENT_CAPABILITIES).toContain('Want me to create the 3 posters?')
    expect(CURRENT_CAPABILITIES).toContain('Then stop and wait')
    expect(CURRENT_CAPABILITIES).toContain('never say the posters are ready, done or created')
    // The go-ahead is acted on by the system: no double confirmation.
    expect(CURRENT_CAPABILITIES).toContain('You never need to ask them to confirm twice')
  })

  it('appends the pending-offer note only while an offer is open, after the capability block', () => {
    const note = buildPendingOfferNote('to create 3 poster(s) for the campaign "Raya Promo"')
    expect(note).toContain('to create 3 poster(s) for the campaign "Raya Promo"')
    expect(note).toContain('Answer their latest message first, then re-offer')
    expect(note).toContain('Do not act on it yourself')

    const withOffer = buildChatSystemPrompt(null, {
      pendingOffer: 'to create 3 poster(s) for the campaign "Raya Promo"',
    })
    expect(withOffer.endsWith(note)).toBe(true)
    expect(withOffer.indexOf(CURRENT_CAPABILITIES)).toBeLessThan(withOffer.indexOf(note))

    expect(buildChatSystemPrompt(null, { pendingOffer: null })).not.toContain('An offer you made')
    expect(buildChatSystemPrompt(null)).not.toContain('An offer you made')
  })
})
