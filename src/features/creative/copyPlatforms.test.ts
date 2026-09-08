import { describe, expect, it } from 'vitest'
import { en } from '@/i18n/messages/en'
import { ms } from '@/i18n/messages/ms'
import type { CreativeCaptions } from '@/types'
import { COPY_PLATFORMS, collapsedPreview, platformCopyEntries } from './copyPlatforms'

/**
 * Phase 7H §20B/§20E: which platform copy a creative has, and — the part that
 * matters — which it does not. A creative made before this phase has no X or
 * TikTok copy and must be shown as having none.
 */

const full: CreativeCaptions = {
  facebook: 'Facebook caption.',
  instagram: 'Instagram caption.',
  short: 'General caption.',
  whatsapp: 'WhatsApp message.',
  x: 'Post for X.',
  tiktok: 'TikTok caption.',
}

/** Exactly the shape a document written before Phase 7H has. */
const legacy = {
  facebook: 'Facebook caption.',
  instagram: 'Instagram caption.',
  short: 'General caption.',
  whatsapp: null,
} as CreativeCaptions

describe('platformCopyEntries', () => {
  it('lists general first, then the platforms, in a fixed order', () => {
    expect(platformCopyEntries(full).map((entry) => entry.platform)).toEqual([
      'general',
      'facebook',
      'instagram',
      'x',
      'tiktok',
      'whatsapp',
    ])
  })

  it('gives every platform its own text — never one caption reused', () => {
    const texts = platformCopyEntries(full).map((entry) => entry.text)
    expect(new Set(texts).size).toBe(texts.length)
  })

  it('omits a legacy creative’s X and TikTok rather than inventing them', () => {
    const platforms = platformCopyEntries(legacy).map((entry) => entry.platform)
    expect(platforms).toEqual(['general', 'facebook', 'instagram'])
    expect(platforms).not.toContain('x')
    expect(platforms).not.toContain('tiktok')
  })

  it('treats whitespace-only copy as absent', () => {
    expect(platformCopyEntries({ ...full, x: '   \n ' }).map((e) => e.platform)).not.toContain('x')
  })

  it('is empty when a creative has no copy at all', () => {
    expect(
      platformCopyEntries({ facebook: null, instagram: null, short: null, whatsapp: null }),
    ).toEqual([])
    expect(platformCopyEntries(null)).toEqual([])
  })

  it('reads each platform from its own stored caption field', () => {
    const byPlatform = Object.fromEntries(
      platformCopyEntries(full).map((entry) => [entry.platform, entry.field]),
    )
    expect(byPlatform).toEqual({
      general: 'short',
      facebook: 'facebook',
      instagram: 'instagram',
      x: 'x',
      tiktok: 'tiktok',
      whatsapp: 'whatsapp',
    })
  })

  it('records owner authority under the existing editable-field names', () => {
    expect(COPY_PLATFORMS.map((spec) => spec.editable)).toEqual([
      'shortCopy',
      'facebookCaption',
      'instagramCaption',
      'xCopy',
      'tiktokCopy',
      'whatsappCopy',
    ])
  })
})

describe('collapsedPreview', () => {
  it('previews the first platform’s own words, not a summary of all of them', () => {
    expect(collapsedPreview(platformCopyEntries(full))).toBe('General caption.')
  })

  it('flattens line breaks so the collapsed row cannot grow', () => {
    const entries = platformCopyEntries({ ...full, short: 'One line.\n\nAnother line.' })
    expect(collapsedPreview(entries)).toBe('One line. Another line.')
  })

  it('is null when there is nothing to preview', () => {
    expect(collapsedPreview([])).toBeNull()
  })
})

describe('platform labels exist in both languages', () => {
  it('every label and chip key is translated', () => {
    for (const spec of COPY_PLATFORMS) {
      expect(en[spec.label]).toBeTruthy()
      expect(ms[spec.label]).toBeTruthy()
      expect(en[spec.chip]).toBeTruthy()
      expect(ms[spec.chip]).toBeTruthy()
    }
  })

  it('names the platforms as proper nouns in both languages', () => {
    expect(en['creative.platformXChip']).toBe('X')
    expect(ms['creative.platformXChip']).toBe('X')
    expect(en['creative.platformTiktokChip']).toBe('TikTok')
    expect(ms['creative.platformTiktokChip']).toBe('TikTok')
  })
})
