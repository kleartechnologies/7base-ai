import { describe, expect, it } from 'vitest'
import type { Creative } from '@/types'
import {
  contrastRatio,
  emphasisOn,
  headlineSizeFor,
  layoutFor,
  posterDesign,
  posterInput,
  posterPalette,
  readableOn,
} from './posterDesign'

/**
 * The design decisions, as data. Every surface draws from `posterInput`, so
 * these are the rules that decide what the owner actually sees — the layout
 * for a creative direction, the roles the brand colour plays, and the type
 * sizes a headline gets.
 */

function creative(overrides: Partial<Creative> = {}): Creative {
  return {
    id: 'c1',
    ownerId: 'u1',
    businessId: 'b1',
    campaignId: 'camp1',
    conversationId: null,
    sourceRecommendationId: null,
    name: 'Launch Poster',
    format: 'square_post',
    status: 'ready',
    content: {
      headline: 'From question to understood',
      subheadline: 'Scan it. Understand every step.',
      body: null,
      callToAction: 'Try free',
      offerText: null,
      image: {
        storagePath: 'businesses/b1/creatives/x.png',
        prompt: null,
        altText: 'app screen',
        source: 'generated',
      },
      layout: 'image_full_bleed',
    },
    captions: { facebook: null, instagram: null, short: null, whatsapp: null },
    style: {
      palette: ['#16a34a', '#0f172a'],
      headingFont: 'Poppins',
      bodyFont: 'Inter',
      logoStoragePath: 'businesses/b1/logo.png',
      direction: 'app_showcase',
    },
    render: null,
    userEdited: [],
    ownerDirectives: [],
    imageError: null,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  } as Creative
}

describe('posterInput', () => {
  it('reads everything from the persisted creative — one canonical image path', () => {
    const input = posterInput(creative())
    expect(input.creativeId).toBe('c1')
    expect(input.imageStoragePath).toBe('businesses/b1/creatives/x.png')
    expect(input.logoStoragePath).toBe('businesses/b1/logo.png')
    expect(input.palette).toEqual(['#16a34a', '#0f172a'])
    expect(input.direction).toBe('app_showcase')
  })

  it('treats a creative from before Phase 7G as a plain editorial poster', () => {
    const legacy = creative({
      style: { palette: null, headingFont: null, bodyFont: null, logoStoragePath: null },
    } as Partial<Creative>)
    const input = posterInput(legacy)
    expect(input.direction).toBeNull()
    expect(layoutFor({ ...input, hasImage: true })).toBe('editorial')
  })

  it('is stable: the same creative always yields the same design', () => {
    const subject = creative()
    expect(posterDesign(posterInput(subject))).toEqual(posterDesign(posterInput(subject)))
  })
})

describe('layoutFor', () => {
  it('gives each creative direction its own arrangement', () => {
    const at = (direction: Parameters<typeof layoutFor>[0]['direction']) =>
      layoutFor({ direction, hasImage: true })
    expect(at('hero_product')).toBe('showcase')
    expect(at('app_showcase')).toBe('showcase')
    expect(at('feature_highlight')).toBe('showcase')
    expect(at('bold_promotional')).toBe('promo')
    expect(at('educational')).toBe('minimal')
    expect(at('minimal_premium')).toBe('minimal')
    expect(at('clean_editorial')).toBe('editorial')
    expect(at('lifestyle')).toBe('editorial')
    // Not one hard-coded poster: the directions really do differ.
    expect(new Set([at('hero_product'), at('bold_promotional'), at('educational')]).size).toBe(3)
  })

  it('still makes a poster when the visual could not be made', () => {
    expect(layoutFor({ direction: 'lifestyle', hasImage: false })).toBe('typographic')
  })
})

describe('posterPalette', () => {
  it('uses the brand colour as the accent and says it came from the brand', () => {
    const palette = posterPalette(['#16a34a'])
    expect(palette.accent).toBe('#16a34a')
    expect(palette.accentFromBrand).toBe(true)
  })

  it('falls back to a neutral — never an invented brand colour', () => {
    const palette = posterPalette(null)
    expect(palette.accentFromBrand).toBe(false)
    expect(palette.accent).toBe('#1f2430')
  })

  it('keeps text on the accent readable', () => {
    expect(readableOn('#facc15')).toBe('#14161c')
    expect(readableOn('#0f172a')).toBe('#ffffff')
    for (const brand of ['#16a34a', '#facc15', '#0f172a', '#e11d48']) {
      expect(contrastRatio(brand, readableOn(brand))).toBeGreaterThanOrEqual(4.5)
    }
  })
})

describe('emphasisOn', () => {
  it('writes in the brand colour when it reads on the ground, and steps aside when it does not', () => {
    // A pale brand yellow on paper would vanish: use the ground's own ink.
    expect(emphasisOn('#f7f6f2', '#fde68a', '#14161c')).toBe('#14161c')
    // A deep brand green on paper carries: use the brand.
    expect(emphasisOn('#f7f6f2', '#166534', '#14161c')).toBe('#166534')
  })
})

describe('headlineSizeFor', () => {
  it('runs short headlines large and steps longer ones down', () => {
    expect(headlineSizeFor('Buy one free one')).toBeGreaterThan(
      headlineSizeFor('Every question explained step by step, in your own language'),
    )
    expect(headlineSizeFor(null)).toBeGreaterThan(0)
  })
})
