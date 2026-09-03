import { describe, expect, it } from 'vitest'

import {
  CreativeValidationError,
  isGrounded,
  moneyTokens,
  readFormat,
  text,
  validateCreativeCopy,
  validateCreativeEdit,
} from './validate'

/**
 * The money clamp is the rule this whole phase hangs on: "consider a weekday
 * lunch set" must never come out the other side as "RM19.90 Weekday Lunch
 * Set". These tests pin that behaviour deterministically — per field, whole
 * field, no reliance on the prompt behaving.
 */

describe('moneyTokens', () => {
  it('normalises RM and MYR amounts to bare digits', () => {
    expect(moneyTokens('Lunch set RM19.90 only')).toEqual(['19.90'])
    expect(moneyTokens('now MYR19.90')).toEqual(['19.90'])
    expect(moneyTokens('RM 19.90 today')).toEqual(['19.90'])
  })

  it('treats a comma decimal as a dot — formatting must not smuggle a price', () => {
    expect(moneyTokens('rm19,90 sahaja')).toEqual(['19.90'])
  })

  it('captures percentages in three languages of "percent"', () => {
    expect(moneyTokens('20% off')).toEqual(['20%'])
    expect(moneyTokens('save 20 percent')).toEqual(['20%'])
    expect(moneyTokens('diskaun 20 peratus')).toEqual(['20%'])
  })

  it('finds nothing in copy without claims', () => {
    expect(moneyTokens('Lunch without the wait')).toEqual([])
  })
})

describe('isGrounded', () => {
  const corpus = 'Weekday lunch set\nRM12.90\nOrder at https://secretrecipe.example'

  it('refuses the canonical invention: a price the campaign never stated', () => {
    expect(isGrounded('RM19.90 Weekday Lunch Set', corpus)).toBe(false)
  })

  it('accepts a price the corpus already contains, in any formatting', () => {
    expect(isGrounded('Only RM12.90!', corpus)).toBe(true)
    expect(isGrounded('now rm 12,90', corpus)).toBe(true)
  })

  it('refuses invented percentages and links', () => {
    expect(isGrounded('20% off this week', corpus)).toBe(false)
    expect(isGrounded('Order at https://other.example', corpus)).toBe(false)
  })

  it('accepts a link the corpus contains, ignoring trailing punctuation', () => {
    expect(isGrounded('Visit https://secretrecipe.example!', corpus)).toBe(true)
  })

  it('accepts claim-free copy against any corpus', () => {
    expect(isGrounded('Lunch without the wait', '')).toBe(true)
  })
})

describe('validateCreativeCopy', () => {
  const corpus = 'Weekday lunch set\nRM12.90'

  it('rejects a non-object response outright', () => {
    expect(() => validateCreativeCopy('a poster!', corpus)).toThrow(CreativeValidationError)
    expect(() => validateCreativeCopy(null, corpus)).toThrow(CreativeValidationError)
  })

  it('nulls the whole field carrying an unsupported price, keeps the rest', () => {
    const copy = validateCreativeCopy(
      {
        headline: 'RM19.90 Weekday Lunch Set',
        shortCopy: 'Lunch without the wait',
        facebookCaption: 'Set lunch at RM12.90 — see you this week.',
      },
      corpus,
    )
    expect(copy.headline).toBeNull()
    expect(copy.shortCopy).toBe('Lunch without the wait')
    expect(copy.facebookCaption).toBe('Set lunch at RM12.90 — see you this week.')
  })

  it('treats filler like "unknown" as absent and clamps runaway copy', () => {
    const copy = validateCreativeCopy(
      { headline: 'unknown', subheadline: 'x'.repeat(400) },
      corpus,
    )
    expect(copy.headline).toBeNull()
    expect(copy.subheadline?.length).toBeLessThanOrEqual(141)
    expect(copy.subheadline?.endsWith('…')).toBe(true)
  })

  it('missing fields come back null, never undefined', () => {
    const copy = validateCreativeCopy({}, corpus)
    expect(copy).toEqual({
      name: null,
      headline: null,
      subheadline: null,
      callToAction: null,
      offerText: null,
      facebookCaption: null,
      instagramCaption: null,
      shortCopy: null,
      whatsappCopy: null,
      imageBrief: null,
      altText: null,
    })
  })
})

describe('validateCreativeEdit', () => {
  const corpus = 'Weekday lunch set\nLunch without the wait'

  it('null fields stay out of the patch — untouched means untouched', () => {
    const edit = validateCreativeEdit(
      { reply: 'Done.', headline: 'An honest lunch, done properly', caption: null },
      corpus,
    )
    expect(edit.reply).toBe('Done.')
    expect(edit.patch).toEqual({ headline: 'An honest lunch, done properly' })
    expect(edit.visualChange).toBeNull()
  })

  it('drops a patched field with an unsupported price instead of storing it', () => {
    const edit = validateCreativeEdit({ reply: null, headline: 'Now RM9.90!' }, corpus)
    expect(edit.patch).toEqual({})
  })

  it("a price in the corpus — the owner's own instruction — is claimable", () => {
    const edit = validateCreativeEdit(
      { reply: null, offerText: 'Lunch set RM15.00' },
      `${corpus}\nSet the price to RM15.00`,
    )
    expect(edit.patch.offerText).toBe('Lunch set RM15.00')
  })

  it('passes a visual change through as a brief, clamped', () => {
    const edit = validateCreativeEdit(
      { reply: null, visualChange: 'A brighter scene, morning light' },
      corpus,
    )
    expect(edit.visualChange).toBe('A brighter scene, morning light')
  })

  it('rejects a non-object response outright', () => {
    expect(() => validateCreativeEdit([], corpus)).toThrow(CreativeValidationError)
  })
})

describe('readFormat', () => {
  it('defaults anything unrecognised to square', () => {
    expect(readFormat('portrait_post')).toBe('portrait_post')
    expect(readFormat('square_post')).toBe('square_post')
    expect(readFormat('story')).toBe('square_post')
    expect(readFormat(undefined)).toBe('square_post')
  })
})

describe('text', () => {
  it('normalises whitespace and refuses filler', () => {
    expect(text('  two   words ', 80)).toBe('two words')
    expect(text('N/A', 80)).toBeNull()
    expect(text('not stated', 80)).toBeNull()
    expect(text(42, 80)).toBeNull()
    expect(text('', 80)).toBeNull()
  })

  it('truncates with an ellipsis at the limit', () => {
    const clamped = text('x'.repeat(100), 80)
    expect(clamped?.length).toBe(81)
    expect(clamped?.endsWith('…')).toBe(true)
  })
})
