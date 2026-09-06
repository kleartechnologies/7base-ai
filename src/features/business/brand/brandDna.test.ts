import { describe, expect, it } from 'vitest'
import type { BrandKit, Business, BusinessDna } from '@/types'
import { applyDetectedBrand, detectedBrandSuggestion, emptyBrandKit } from './brandKit'
import { knownSources } from './sources'

/**
 * Phase 7E on the client: the DNA report reaches the Brand Identity tab as
 * a suggestion through the same per-field gate as 7D.1, "Use these" is the
 * ONLY path into the kit, and it never overwrites what the owner set,
 * never applies an unapproved font, and references a logo Asset rather
 * than copying it.
 */

function dna(over: Partial<BusinessDna['brand']> = {}, business: Partial<BusinessDna['business']> = {}): BusinessDna {
  return {
    version: 1,
    analysedAt: 1,
    sources: [
      { type: 'facebook', reference: 'https://www.facebook.com/warungmakcik', status: 'analyzed', count: 1 },
      { type: 'asset', reference: null, status: 'analyzed', count: 3 },
    ],
    business: {
      businessName: 'Warung Mak Cik',
      category: 'Restaurant',
      productsServices: [],
      bestSellers: [],
      targetAudience: null,
      location: null,
      positioning: null,
      valueProposition: null,
      differentiators: [],
      tagline: null,
      keyMessages: [],
      tone: null,
      personalityTraits: [],
      description: null,
      ...business,
    },
    brand: {
      logoCandidate: { kind: 'asset', assetId: 'asset_logo', url: null, source: 'asset', confidence: 'high' },
      colors: [
        { hex: '#1a7f5a', confidence: 'high', provenance: 'extracted', source: 'website' },
        { hex: '#1A7F5A', confidence: 'low', provenance: 'observed', source: 'facebook' },
        { hex: '#c0392b', confidence: 'medium', provenance: 'observed', source: 'facebook' },
        { hex: '#2980b9', confidence: 'medium', provenance: 'observed', source: 'asset' },
        { hex: '#8e44ad', confidence: 'low', provenance: 'observed', source: 'asset' },
      ],
      typography: { detectedFont: 'Plus Jakarta Sans', supportedMatch: null, source: 'website', confidence: 'high' },
      visualStyle: 'Warm food photography',
      styleTraits: ['warm', 'rustic', 'quirky'],
      suggestedTraits: ['warm', 'traditional'],
      imageryStyle: null,
      compositionStyle: null,
      visualMood: null,
      confidence: 'medium',
      ...over,
    },
    unknowns: [],
  }
}

function business(over: { dna?: BusinessDna | null; brandKit?: BrandKit | null } = {}) {
  return {
    brand: null,
    brandKit: over.brandKit ?? null,
    discovery: over.dna === undefined ? null : ({ dna: over.dna } as unknown as Business['discovery']),
  }
}

describe('detectedBrandSuggestion from Business DNA', () => {
  it('turns the report into a source-neutral suggestion with capped, de-duplicated colours', () => {
    const suggestion = detectedBrandSuggestion(business({ dna: dna() }))
    expect(suggestion).toEqual({
      colors: ['#1a7f5a', '#c0392b', '#2980b9'],
      logoUrl: null,
      logoAssetId: 'asset_logo',
      fontFamily: 'Plus Jakarta Sans',
      supportedFont: null,
      visualStyle: 'Warm food photography',
      traits: ['warm', 'traditional'],
      category: 'Restaurant',
      sources: dna().sources,
      unknown: [],
      source: 'sources',
    })
  })

  it('lists what the analysis could not establish as unknown slots', () => {
    const suggestion = detectedBrandSuggestion(
      business({ dna: dna({ logoCandidate: null, colors: [], typography: null }) }),
    )
    expect(suggestion?.unknown).toEqual(['logo', 'colors', 'typography'])
    expect(suggestion?.visualStyle).toBe('Warm food photography')
  })

  it('suppresses each field the owner already filled, and goes quiet once all are applied', () => {
    const partial = detectedBrandSuggestion(
      business({
        dna: dna(),
        brandKit: { ...emptyBrandKit(1), logoAssetId: 'owner_logo', colors: { primary: '#000000', secondary: null, accent: null } },
      }),
    )
    expect(partial?.logoAssetId).toBeNull()
    expect(partial?.colors).toEqual([])
    expect(partial?.fontFamily).toBe('Plus Jakarta Sans')
    // A filled slot is never reported as unknown either.
    expect(partial?.unknown).toEqual([])

    const applied = detectedBrandSuggestion(
      business({
        dna: dna(),
        brandKit: {
          logoAssetId: 'asset_logo',
          colors: { primary: '#1a7f5a', secondary: '#c0392b', accent: '#2980b9' },
          typography: { heading: 'Poppins', body: 'Poppins' },
          styleTraits: ['warm'],
          styleNotes: null,
          notes: null,
          updatedAt: 2,
        },
      }),
    )
    expect(applied).toBeNull()
  })

  it('prefers the DNA over the legacy discovered brand when both exist', () => {
    const suggestion = detectedBrandSuggestion({
      brand: {
        value: {
          voice: null,
          personalityTraits: [],
          colors: [{ label: 'Old', hex: '#123456' }],
          logoUrl: 'https://example.com/old.png',
          fontFamily: 'Raleway',
          visualStyle: 'old style',
          keyMessages: [],
          valuePropositions: [],
        },
        source: 'website',
        sourceRef: 'https://example.com',
        confidence: 0.8,
        confirmed: false,
        discoveredAt: 1,
      },
      brandKit: null,
      discovery: { dna: dna() } as unknown as Business['discovery'],
    })
    expect(suggestion?.source).toBe('sources')
    expect(suggestion?.colors[0]).toBe('#1a7f5a')
  })
})

describe('"Use these" with a DNA suggestion', () => {
  const suggestion = detectedBrandSuggestion(business({ dna: dna() }))!

  it('references the logo Asset, seeds colours and traits, carries the style, and never applies an unapproved font', () => {
    const next = applyDetectedBrand(emptyBrandKit(1), suggestion, 99)
    expect(next.logoAssetId).toBe('asset_logo')
    expect(next.colors).toEqual({ primary: '#1a7f5a', secondary: '#c0392b', accent: '#2980b9' })
    expect(next.styleTraits).toEqual(['warm', 'traditional'])
    expect(next.styleNotes).toBe('Warm food photography')
    // "Plus Jakarta Sans" is not on the closed list: no silent mapping.
    expect(next.typography).toEqual({ heading: null, body: null })
  })

  it('applies the approved font only when the owner set none', () => {
    const withPoppins = detectedBrandSuggestion(
      business({ dna: dna({ typography: { detectedFont: 'Poppins', supportedMatch: 'Poppins', source: 'website', confidence: 'high' } }) }),
    )!
    expect(applyDetectedBrand(emptyBrandKit(1), withPoppins, 99).typography).toEqual({ heading: 'Poppins', body: 'Poppins' })
    const ownerFont = { ...emptyBrandKit(1), typography: { heading: 'Inter' as const, body: null } }
    expect(applyDetectedBrand(ownerFont, withPoppins, 99).typography).toEqual({ heading: 'Inter', body: null })
  })

  it('never overwrites anything the owner already set', () => {
    const owned: BrandKit = {
      logoAssetId: 'owner_logo',
      colors: { primary: '#000000', secondary: null, accent: '#ffffff' },
      typography: { heading: 'Inter', body: 'Inter' },
      styleTraits: ['minimal'],
      styleNotes: 'my words',
      notes: null,
      updatedAt: 5,
    }
    const next = applyDetectedBrand(owned, suggestion, 99)
    expect(next).toEqual({ ...owned, colors: { primary: '#000000', secondary: '#c0392b', accent: '#ffffff' }, updatedAt: 99 })
  })
})

describe('knownSources', () => {
  it('collects one page per kind from the business document, normalised', () => {
    const sources = knownSources({
      contact: {
        email: null,
        phone: null,
        whatsapp: null,
        website: 'warungmakcik.com',
        socialProfiles: [
          { platform: 'instagram', handle: 'warungmakcik', url: 'https://www.instagram.com/warungmakcik/' },
          { platform: 'facebook', handle: 'x', url: 'not a url' },
        ],
      },
      sources: [
        { id: 'facebook', kind: 'facebook', label: 'Facebook', reference: 'https://www.facebook.com/warungmakcik', status: 'connected', lastSyncedAt: 1 },
        { id: 'document', kind: 'document', label: 'Uploaded assets', reference: 'uploaded-assets', status: 'connected', lastSyncedAt: 1 },
      ],
      discovery: { sourceRef: 'https://another-site.example.com' },
    } as unknown as Business)
    expect(sources).toEqual([
      { kind: 'website', url: 'https://warungmakcik.com/' },
      { kind: 'instagram', url: 'https://www.instagram.com/warungmakcik/' },
      { kind: 'facebook', url: 'https://www.facebook.com/warungmakcik/' },
    ])
  })

  it('is empty for a business with nothing on file', () => {
    expect(knownSources({ contact: null, sources: [], discovery: null } as unknown as Business)).toEqual([])
  })
})
