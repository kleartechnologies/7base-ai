import { describe, expect, it } from 'vitest'
import type { BrandKit, BrandStyleTrait, Business } from '@/types'
import {
  applyDetectedBrand,
  brandKitChecklist,
  brandKitProgress,
  brandKitStatus,
  canSelectTrait,
  detectedBrandSuggestion,
  emptyBrandKit,
  isBrandFont,
  isBrandTrait,
  normalizeBrandHex,
  toggleTrait,
  type DetectedBrandSuggestion,
} from './brandKit'

/** A kit that satisfies every required section. */
function readyKit(overrides: Partial<BrandKit> = {}): BrandKit {
  return {
    logoAssetId: 'asset-1',
    colors: { primary: '#1a7f5a', secondary: '#f5efe6', accent: '#c2410c' },
    typography: { heading: 'Poppins', body: 'Inter' },
    styleTraits: ['modern', 'warm'],
    styleNotes: null,
    notes: null,
    updatedAt: 1,
    ...overrides,
  }
}

function discoveredBrand(
  overrides: Partial<NonNullable<Business['brand']>['value']> = {},
  source: NonNullable<Business['brand']>['source'] = 'website',
): NonNullable<Business['brand']> {
  return {
    value: {
      voice: null,
      personalityTraits: [],
      colors: [
        { label: 'Primary', hex: '#1A7F5A' },
        { label: 'Cream', hex: '#F5EFE6' },
      ],
      logoUrl: 'https://example.com/logo.png',
      fontFamily: 'Raleway',
      visualStyle: 'warm, photo-led',
      keyMessages: [],
      valuePropositions: [],
      ...overrides,
    },
    source,
    sourceRef: 'https://example.com',
    confidence: 0.8,
    confirmed: false,
    discoveredAt: 1,
  }
}

describe('normalizeBrandHex', () => {
  it('accepts all four accepted spellings and returns lowercase #rrggbb', () => {
    expect(normalizeBrandHex('#1A7F5A')).toBe('#1a7f5a')
    expect(normalizeBrandHex('1A7F5A')).toBe('#1a7f5a')
    expect(normalizeBrandHex('#FA0')).toBe('#ffaa00')
    expect(normalizeBrandHex('fa0')).toBe('#ffaa00')
    expect(normalizeBrandHex('  #1a7f5a  ')).toBe('#1a7f5a')
  })

  it('rejects everything that is not a 3- or 6-digit hex', () => {
    for (const bad of ['', '#', 'red', '#12', '#1234', '#12345', '#1234567', '#gggggg', '1a7f5g']) {
      expect(normalizeBrandHex(bad)).toBeNull()
    }
  })
})

describe('closed lists', () => {
  it('accepts only the approved fonts', () => {
    expect(isBrandFont('Inter')).toBe(true)
    expect(isBrandFont('DM Serif Display')).toBe(true)
    expect(isBrandFont('Comic Sans MS')).toBe(false)
    expect(isBrandFont(null)).toBe(false)
  })

  it('accepts only the canonical trait ids', () => {
    expect(isBrandTrait('modern')).toBe(true)
    expect(isBrandTrait('Modern')).toBe(false)
    expect(isBrandTrait('edgy')).toBe(false)
  })
})

describe('derived completion', () => {
  it('empty kit and missing kit are not started', () => {
    expect(brandKitStatus(null)).toBe('not_started')
    expect(brandKitStatus(undefined)).toBe('not_started')
    expect(brandKitStatus(emptyBrandKit(1))).toBe('not_started')
  })

  it('any single filled section makes it partial', () => {
    expect(brandKitStatus({ ...emptyBrandKit(1), logoAssetId: 'a' })).toBe('partial')
    expect(
      brandKitStatus({ ...emptyBrandKit(1), styleTraits: ['modern', 'warm'] as BrandStyleTrait[] }),
    ).toBe('partial')
  })

  it('ready requires logo, all three colours, both fonts and ≥2 traits', () => {
    expect(brandKitStatus(readyKit())).toBe('ready')
    expect(brandKitStatus(readyKit({ logoAssetId: null }))).toBe('partial')
    expect(
      brandKitStatus(readyKit({ colors: { primary: '#111111', secondary: null, accent: '#222222' } })),
    ).toBe('partial')
    expect(brandKitStatus(readyKit({ typography: { heading: 'Inter', body: null } }))).toBe(
      'partial',
    )
    expect(brandKitStatus(readyKit({ styleTraits: ['modern'] }))).toBe('partial')
  })

  it('notes never affect readiness in either direction', () => {
    // Ready stays ready without notes…
    expect(brandKitStatus(readyKit({ notes: null, styleNotes: null }))).toBe('ready')
    // …and notes alone never make an incomplete kit ready.
    expect(brandKitStatus({ ...emptyBrandKit(1), notes: 'always halal-certified' })).toBe('partial')
  })

  it('progress counts the five checklist rows', () => {
    expect(brandKitProgress(null)).toEqual({ done: 0, total: 5 })
    expect(brandKitProgress(readyKit())).toEqual({ done: 4, total: 5 })
    expect(brandKitProgress(readyKit({ notes: 'x' }))).toEqual({ done: 5, total: 5 })
  })

  it('checklist counts styleNotes as the optional notes row too', () => {
    expect(brandKitChecklist({ ...emptyBrandKit(1), styleNotes: 'earthy' }).notes).toBe(true)
    expect(brandKitChecklist({ ...emptyBrandKit(1), notes: '   ' }).notes).toBe(false)
  })
})

describe('trait selection limits', () => {
  const four = ['modern', 'premium', 'friendly', 'playful'] as BrandStyleTrait[]

  it('caps selection at four', () => {
    expect(canSelectTrait(four, 'minimal')).toBe(false)
    expect(toggleTrait(four, 'minimal')).toEqual(four)
  })

  it('an already-selected trait can always be toggled off', () => {
    expect(canSelectTrait(four, 'modern')).toBe(true)
    expect(toggleTrait(four, 'modern')).toEqual(['premium', 'friendly', 'playful'])
  })

  it('adds below the cap', () => {
    expect(toggleTrait(['modern'] as BrandStyleTrait[], 'warm')).toEqual(['modern', 'warm'])
  })
})

describe('detectedBrandSuggestion', () => {
  it('returns nothing when discovery found no brand', () => {
    expect(detectedBrandSuggestion({ brand: null, brandKit: null })).toBeNull()
  })

  it('surfaces discovered colours and logo, normalised, capped at three', () => {
    const suggestion = detectedBrandSuggestion({
      brand: discoveredBrand({
        colors: [
          { label: 'a', hex: '#1A7F5A' },
          { label: 'b', hex: 'F5EFE6' },
          { label: 'c', hex: '#C2410C' },
          { label: 'd', hex: '#000000' },
        ],
      }),
      brandKit: null,
    })
    expect(suggestion).not.toBeNull()
    expect(suggestion?.colors).toEqual(['#1a7f5a', '#f5efe6', '#c2410c'])
    expect(suggestion?.logoUrl).toBe('https://example.com/logo.png')
    expect(suggestion?.source).toBe('website')
  })

  it('drops colours that do not normalise', () => {
    const suggestion = detectedBrandSuggestion({
      brand: discoveredBrand({ colors: [{ label: 'bad', hex: 'reddish' }], logoUrl: null }),
      brandKit: null,
    })
    // The bad colour is dropped, not repaired; the rest still surfaces.
    expect(suggestion?.colors).toEqual([])
    expect(suggestion?.fontFamily).toBe('Raleway')
    expect(suggestion?.visualStyle).toBe('warm, photo-led')
  })

  it('returns nothing when no usable field is left', () => {
    const suggestion = detectedBrandSuggestion({
      brand: discoveredBrand({
        colors: [{ label: 'bad', hex: 'reddish' }],
        logoUrl: null,
        fontFamily: null,
        visualStyle: null,
      }),
      brandKit: null,
    })
    expect(suggestion).toBeNull()
  })

  it('suppresses each field once the owner has filled its slot (Phase 7D.1)', () => {
    const brand = discoveredBrand()
    // A manually-set logo silences only the logo — everything else survives.
    const withLogo = detectedBrandSuggestion({
      brand,
      brandKit: { ...emptyBrandKit(1), logoAssetId: 'a' },
    })
    expect(withLogo?.logoUrl).toBeNull()
    expect(withLogo?.colors).toEqual(['#1a7f5a', '#f5efe6'])
    expect(withLogo?.visualStyle).toBe('warm, photo-led')
    // Owner-set colours silence only the colours.
    const withColors = detectedBrandSuggestion({
      brand,
      brandKit: { ...emptyBrandKit(1), colors: { primary: '#111111', secondary: null, accent: null } },
    })
    expect(withColors?.colors).toEqual([])
    expect(withColors?.logoUrl).toBe('https://example.com/logo.png')
    // Typography and style notes silence the font hint and the style text.
    const withRest = detectedBrandSuggestion({
      brand,
      brandKit: {
        ...emptyBrandKit(1),
        typography: { heading: 'Inter', body: null },
        styleNotes: 'my own words',
      },
    })
    expect(withRest?.fontFamily).toBeNull()
    expect(withRest?.visualStyle).toBeNull()
    // An untouched kit hides nothing.
    expect(detectedBrandSuggestion({ brand, brandKit: emptyBrandKit(1) })).not.toBeNull()
  })

  it('goes quiet only when every slot the card covers is owner-filled', () => {
    const brand = discoveredBrand()
    expect(
      detectedBrandSuggestion({
        brand,
        brandKit: {
          ...emptyBrandKit(1),
          logoAssetId: 'a',
          colors: { primary: '#111111', secondary: null, accent: null },
          typography: { heading: 'Inter', body: null },
          styleTraits: ['modern', 'minimal'],
        },
      }),
    ).toBeNull()
  })

  it('surfaces a visualStyle-only discovery — the stranded-field case', () => {
    const suggestion = detectedBrandSuggestion({
      brand: discoveredBrand({
        colors: [],
        logoUrl: null,
        fontFamily: null,
        visualStyle: 'Clean, modern and visual',
      }),
      brandKit: { ...emptyBrandKit(1), logoAssetId: 'manual-upload' },
    })
    expect(suggestion).toEqual({
      colors: [],
      logoUrl: null,
      fontFamily: null,
      visualStyle: 'Clean, modern and visual',
      logoAssetId: null,
      supportedFont: null,
      traits: [],
      category: null,
      sources: [],
      unknown: [],
      source: 'website',
    })
  })

  it('maps unknown sources to "other"', () => {
    const suggestion = detectedBrandSuggestion({
      brand: discoveredBrand({}, 'inferred'),
      brandKit: null,
    })
    expect(suggestion?.source).toBe('other')
  })
})

describe('applyDetectedBrand — the only path from discovery into the kit', () => {
  const suggestion: DetectedBrandSuggestion = {
    colors: ['#1a7f5a', '#f5efe6', '#c2410c'],
    logoUrl: 'https://example.com/logo.png',
    logoAssetId: null,
    fontFamily: 'Raleway',
    supportedFont: null,
    visualStyle: 'warm, photo-led',
    traits: [],
    category: null,
    sources: [],
    unknown: [],
    source: 'website',
  }

  it('seeds colours in order and carries visualStyle into styleNotes', () => {
    const next = applyDetectedBrand(emptyBrandKit(1), suggestion, 99)
    expect(next.colors).toEqual({ primary: '#1a7f5a', secondary: '#f5efe6', accent: '#c2410c' })
    expect(next.styleNotes).toBe('warm, photo-led')
    expect(next.updatedAt).toBe(99)
  })

  it('never auto-applies the discovered font or logo', () => {
    const next = applyDetectedBrand(emptyBrandKit(1), suggestion, 99)
    expect(next.typography).toEqual({ heading: null, body: null })
    expect(next.logoAssetId).toBeNull()
  })

  it('keeps what the owner already wrote', () => {
    const next = applyDetectedBrand(
      { ...emptyBrandKit(1), styleNotes: 'my own words' },
      suggestion,
      99,
    )
    expect(next.styleNotes).toBe('my own words')
  })
})
