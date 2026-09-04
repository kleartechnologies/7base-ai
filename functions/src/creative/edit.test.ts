import { describe, expect, it } from 'vitest'

import { applyCreativePatch, extractDirective, withDirective } from './edit'
import { buildStoredCreative, type StoredCreative } from './store'

/**
 * The authority model, applied to creative copy. Not a second system — the
 * same rule campaigns use: what the owner touched is theirs, and an
 * assistant-sourced update can never silently take it back.
 */

function makeCreative(): StoredCreative {
  return buildStoredCreative({
    ownerId: 'user1',
    businessId: 'biz1',
    campaignId: 'camp1',
    conversationId: 'conv1',
    sourceRecommendationId: 'rec1',
    name: 'Weekday Lunch Growth Poster',
    format: 'square_post',
    content: {
      headline: 'Lunch without the wait',
      subheadline: null,
      body: null,
      callToAction: 'Order on WhatsApp',
      offerText: null,
      image: null,
      layout: 'text_only',
    },
    captions: {
      facebook: 'Lunch without the wait. Order on WhatsApp.',
      instagram: 'Lunch without the wait.',
      short: 'Lunch without the wait.',
      whatsapp: null,
    },
    style: { palette: null, headingFont: null, bodyFont: null, logoStoragePath: null },
    assetIds: [],
    imageError: null,
    meta: null,
    now: 1000,
  })
}

describe('applyCreativePatch', () => {
  it('applies flattened fields into their nested homes and reports the change', () => {
    const { creative, changed } = applyCreativePatch(
      makeCreative(),
      { headline: 'An honest lunch, done properly', facebookCaption: 'New caption.' },
      'user_instruction',
      2000,
    )
    expect(creative.content.headline).toBe('An honest lunch, done properly')
    expect(creative.captions.facebook).toBe('New caption.')
    expect(changed.sort()).toEqual(['facebookCaption', 'headline'])
    expect(creative.updatedAt).toBe(2000)
  })

  it('a user instruction takes authority over the fields it touched', () => {
    const { creative } = applyCreativePatch(
      makeCreative(),
      { headline: 'Premium lunch, properly done' },
      'user_instruction',
    )
    expect(creative.userEdited).toContain('headline')
  })

  it('an assistant patch cannot revert an owner-set field', () => {
    const owned = makeCreative()
    owned.userEdited = ['headline']
    const { creative, changed } = applyCreativePatch(
      owned,
      { headline: 'Something else entirely', shortCopy: 'Fresh short copy.' },
      'assistant',
      2000,
    )
    expect(creative.content.headline).toBe('Lunch without the wait')
    expect(creative.captions.short).toBe('Fresh short copy.')
    expect(changed).toEqual(['shortCopy'])
    // And the assistant gains no authority for what it did change.
    expect(creative.userEdited).toEqual(['headline'])
  })

  it('a no-op value neither changes nor claims authority', () => {
    const { creative, changed } = applyCreativePatch(
      makeCreative(),
      { headline: 'Lunch without the wait' },
      'user_instruction',
      2000,
    )
    expect(changed).toEqual([])
    expect(creative.userEdited).toEqual([])
    expect(creative.updatedAt).toBe(1000)
  })

  it('does not mutate the original creative', () => {
    const original = makeCreative()
    applyCreativePatch(original, { headline: 'Changed' }, 'user_instruction')
    expect(original.content.headline).toBe('Lunch without the wait')
    expect(original.userEdited).toEqual([])
  })
})

describe('extractDirective', () => {
  it('recognises standing constraints, English and Malay', () => {
    expect(extractDirective("Don't mention discounts")).toBe("Don't mention discounts")
    expect(extractDirective('Never use emoji')).toBe('Never use emoji')
    expect(extractDirective('no discounts please')).toBe('no discounts please')
    expect(extractDirective('jangan letak harga')).toBe('jangan letak harga')
    expect(extractDirective('tak nak hashtag')).toBe('tak nak hashtag')
  })

  it('a one-off edit instruction is not a standing rule', () => {
    expect(extractDirective('Make the headline more premium')).toBeNull()
    expect(extractDirective('Change the CTA')).toBeNull()
    expect(extractDirective('Make the caption shorter')).toBeNull()
  })

  it('empty input yields nothing', () => {
    expect(extractDirective('   ')).toBeNull()
  })
})

describe('withDirective', () => {
  it('appends, deduplicates case-insensitively, ignores null', () => {
    expect(withDirective([], "Don't mention discounts")).toEqual(["Don't mention discounts"])
    expect(withDirective(["Don't mention discounts"], "don't mention discounts")).toEqual([
      "Don't mention discounts",
    ])
    expect(withDirective(['a'], null)).toEqual(['a'])
  })

  it('keeps only the newest ten', () => {
    const many = Array.from({ length: 10 }, (_, i) => `rule ${i}`)
    const result = withDirective(many, 'rule new')
    expect(result).toHaveLength(10)
    expect(result[0]).toBe('rule 1')
    expect(result[9]).toBe('rule new')
  })
})
