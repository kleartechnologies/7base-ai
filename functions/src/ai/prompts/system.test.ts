import { describe, expect, it } from 'vitest'

import { buildChatSystemPrompt, CURRENT_CAPABILITIES, EVA_IDENTITY } from './system'

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
