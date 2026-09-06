import { describe, expect, it } from 'vitest'

import type { DnaSourceSummary } from '../../lib/business.types'
import { fillEmptyBrandVisuals, mergeWebsiteAnalysis } from '../brain/merge'
import type { SourceEvidence, VisualEvidence } from './evidence'
import { dnaAnalysis, emptyBrain, NOW } from './fixtures'
import {
  analysedSources,
  ASSETS_SOURCE_REF,
  buildBusinessDna,
  confidenceFor,
  logoCandidate,
  primarySource,
  rankColors,
  stampAdditionalSources,
  toBrandVisual,
  type DnaMergeInput,
} from './merge'

/**
 * From validated DNA to (1) the BrandVisual the existing brain merge eats
 * and (2) the `discovery.dna` report the card renders. Authority stays in
 * the brain merge: these tests check that the DNA layer never writes a
 * Brand Kit, never invents a logo URL, and stamps every source it read.
 */

const WEBSITE = 'https://warungmakcik.com/'
const FACEBOOK = 'https://www.facebook.com/warungmakcik'

const sources = (over: Partial<DnaSourceSummary>[] = []): DnaSourceSummary[] =>
  over.map((s) => ({ type: 'website', reference: WEBSITE, status: 'analyzed', count: 1, ...s }))

const visual = (over: Partial<VisualEvidence>): VisualEvidence => ({
  id: 'img1',
  role: 'hero',
  sourceType: 'website',
  ref: 'https://warungmakcik.com/img/hero.jpg',
  assetId: null,
  assetType: null,
  label: 'hero',
  contentType: 'image/jpeg',
  dataUrl: 'data:image/jpeg;base64,/9j/',
  ...over,
})

const fontEvidence = (sourceType: SourceEvidence['sourceType'] = 'website'): SourceEvidence => ({
  id: 'e3',
  sourceType,
  sourceRef: WEBSITE,
  canonicalUrl: WEBSITE,
  kind: 'font',
  value: 'Poppins',
  confidence: 'high',
  provenance: 'deterministic',
  metadata: {},
  imageRef: null,
  assetId: null,
})

function input(over: Partial<DnaMergeInput> = {}): DnaMergeInput {
  return {
    analysis: dnaAnalysis(),
    sources: sources([{}]),
    evidence: [],
    visuals: [],
    websiteVisual: null,
    now: NOW,
    ...over,
  }
}

describe('primarySource / analysedSources', () => {
  it('prefers the website, then facebook, then instagram, then the uploads', () => {
    const all = sources([
      { type: 'instagram', reference: 'https://www.instagram.com/warungmakcik/' },
      { type: 'asset', reference: null, count: 3 },
      { type: 'facebook', reference: FACEBOOK },
      { type: 'website', reference: WEBSITE },
    ])
    expect(analysedSources(all).map((s) => s.kind)).toEqual(['website', 'facebook', 'instagram', 'document'])
    expect(primarySource(all)).toEqual({ kind: 'website', reference: WEBSITE })
  })

  it('skips sources that were limited, inaccessible or failed', () => {
    const all = sources([
      { type: 'website', status: 'inaccessible' },
      { type: 'facebook', reference: FACEBOOK, status: 'limited' },
      { type: 'instagram', reference: 'https://www.instagram.com/warungmakcik/', status: 'analyzed' },
    ])
    expect(primarySource(all)).toEqual({ kind: 'instagram', reference: 'https://www.instagram.com/warungmakcik/' })
    expect(primarySource(sources([{ status: 'failed' }]))).toBeNull()
  })

  it('an Assets-only business is stamped as document with the uploads reference', () => {
    expect(primarySource(sources([{ type: 'asset', reference: null, count: 4 }]))).toEqual({
      kind: 'document',
      reference: ASSETS_SOURCE_REF,
    })
  })
})

describe('stampAdditionalSources', () => {
  it('adds one ConnectedSource per extra source and lists analysed social pages as profiles', () => {
    const stored = emptyBrain()
    const patch = stampAdditionalSources(
      { sources: [] },
      stored,
      [
        { kind: 'facebook', reference: FACEBOOK },
        { kind: 'document', reference: ASSETS_SOURCE_REF },
      ],
      NOW,
    )
    expect(patch.sources?.map((s) => [s.id, s.reference])).toEqual([
      ['facebook', FACEBOOK],
      ['document', ASSETS_SOURCE_REF],
    ])
    expect(patch.contact?.socialProfiles).toEqual([
      { platform: 'facebook', handle: 'warungmakcik', url: FACEBOOK },
    ])
    // Website and owner-set fields are untouched.
    expect(patch.contact?.website).toBeNull()
    expect(patch.brandKit).toBeUndefined()
  })

  it('does not duplicate a profile the owner already listed', () => {
    const stored = emptyBrain({
      contact: {
        email: null,
        phone: null,
        whatsapp: null,
        website: null,
        socialProfiles: [{ platform: 'facebook', handle: 'warungmakcik', url: `${FACEBOOK}/` }],
      },
    })
    const patch = stampAdditionalSources({}, stored, [{ kind: 'facebook', reference: FACEBOOK }], NOW)
    expect(patch.contact?.socialProfiles).toHaveLength(1)
  })
})

describe('rankColors', () => {
  it('puts deterministic markup colours first, then observed ones, de-duplicated and capped', () => {
    const colors = rankColors(
      input({
        websiteVisual: { colors: [{ label: 'Theme color', hex: '#1a7f5a' }], logoUrl: null, fontFamily: null, fontName: null },
        visuals: [visual({ id: 'img1', sourceType: 'facebook' })],
        analysis: dnaAnalysis(
          {},
          {
            colors: [
              { hex: '#1a7f5a', confidence: 'low', seenIn: 'img1' },
              { hex: '#c0392b', confidence: 'medium', seenIn: 'img1' },
              { hex: '#2980b9', confidence: 'medium', seenIn: 'markup' },
              { hex: '#8e44ad', confidence: 'low', seenIn: 'img7' },
              { hex: '#f39c12', confidence: 'low', seenIn: 'img7' },
              { hex: '#16a085', confidence: 'low', seenIn: 'img7' },
            ],
          },
        ),
      }),
    )
    expect(colors).toHaveLength(5)
    expect(colors[0]).toEqual({ hex: '#1a7f5a', confidence: 'high', provenance: 'extracted', source: 'website' })
    expect(colors[1]).toEqual({ hex: '#c0392b', confidence: 'medium', provenance: 'observed', source: 'facebook' })
    // "markup" / unknown image → the first analysed source.
    expect(colors[2]?.source).toBe('website')
  })
})

describe('logoCandidate', () => {
  it('resolves the model’s pick to an asset reference — never a copy, never a URL', () => {
    const candidate = logoCandidate(
      input({
        visuals: [visual({ id: 'img1', role: 'asset', sourceType: 'asset', ref: 'a_logo', assetId: 'a_logo', assetType: 'logo' })],
        analysis: dnaAnalysis({}, { logoImageId: 'img1' }),
      }),
    )
    expect(candidate).toEqual({ kind: 'asset', assetId: 'a_logo', url: null, source: 'asset', confidence: 'high' })
  })

  it('resolves a page image pick to the URL the source exposed', () => {
    const candidate = logoCandidate(
      input({
        visuals: [visual({ id: 'img2', role: 'logo_candidate', sourceType: 'instagram', ref: 'https://scontent.example.com/pic.jpg' })],
        analysis: dnaAnalysis({}, { logoImageId: 'img2' }),
      }),
    )
    expect(candidate).toEqual({
      kind: 'url',
      assetId: null,
      url: 'https://scontent.example.com/pic.jpg',
      source: 'instagram',
      confidence: 'high',
    })
  })

  it('ignores an id that was not attached, then falls back to a logo-typed Asset, then the site icon', () => {
    const base = input({ analysis: dnaAnalysis({}, { logoImageId: 'img9' }) })
    expect(logoCandidate(base)).toBeNull()

    const withAsset = input({
      ...base,
      visuals: [visual({ id: 'img1', role: 'asset', sourceType: 'asset', ref: 'a_logo', assetId: 'a_logo', assetType: 'logo' })],
    })
    expect(logoCandidate(withAsset)?.assetId).toBe('a_logo')

    const withIcon = input({
      ...base,
      websiteVisual: { colors: [], logoUrl: 'https://warungmakcik.com/icon.png', fontFamily: null, fontName: null },
    })
    expect(logoCandidate(withIcon)).toEqual({
      kind: 'url',
      assetId: null,
      url: 'https://warungmakcik.com/icon.png',
      source: 'website',
      confidence: 'medium',
    })
  })
})

describe('toBrandVisual', () => {
  it('carries three labelled colours, a URL logo only, the approved font and the raw name', () => {
    const result = toBrandVisual(
      input({
        websiteVisual: {
          colors: [{ label: 'Theme color', hex: '#1a7f5a' }],
          logoUrl: 'https://warungmakcik.com/icon.png',
          fontFamily: null,
          fontName: 'Plus Jakarta Sans',
        },
        visuals: [visual({ id: 'img1', sourceType: 'asset', assetId: 'a1', assetType: 'photo', ref: 'a1', role: 'asset' })],
        analysis: dnaAnalysis(
          {},
          {
            colors: [
              { hex: '#c0392b', confidence: 'medium', seenIn: 'img1' },
              { hex: '#2980b9', confidence: 'medium', seenIn: 'img1' },
              { hex: '#8e44ad', confidence: 'medium', seenIn: 'img1' },
            ],
          },
        ),
      }),
    )
    expect(result).toEqual({
      colors: [
        { label: 'Theme color', hex: '#1a7f5a' },
        { label: 'Uploaded asset', hex: '#c0392b' },
        { label: 'Uploaded asset', hex: '#2980b9' },
      ],
      logoUrl: 'https://warungmakcik.com/icon.png',
      fontFamily: null,
      fontName: 'Plus Jakarta Sans',
    })
  })

  it('an Asset logo never becomes a brain logo URL', () => {
    const result = toBrandVisual(
      input({
        visuals: [visual({ id: 'img1', role: 'asset', sourceType: 'asset', ref: 'a_logo', assetId: 'a_logo', assetType: 'logo' })],
        analysis: dnaAnalysis({}, { logoImageId: 'img1', detectedFont: 'Poppins', supportedFont: 'Poppins' }),
      }),
    )
    expect(result.logoUrl).toBeNull()
    expect(result.fontFamily).toBe('Poppins')
    expect(result.fontName).toBe('Poppins')
  })
})

describe('buildBusinessDna', () => {
  it('reports business and brand DNA with provenance, without touching any kit', () => {
    const dna = buildBusinessDna(
      input({
        sources: sources([{}, { type: 'facebook', reference: FACEBOOK, status: 'limited', count: 1 }]),
        evidence: [fontEvidence('website')],
        analysis: dnaAnalysis(
          {},
          {
            detectedFont: 'Plus Jakarta Sans',
            supportedFont: null,
            visualStyle: 'Warm food photography',
            styleTraits: ['warm', 'rustic'],
            suggestedTraits: ['warm', 'traditional'],
            visualMood: 'Homely',
            confidence: 'medium',
          },
        ),
      }),
    )
    expect(dna.version).toBe(1)
    expect(dna.analysedAt).toBe(NOW)
    expect(dna.sources).toHaveLength(2)
    expect(dna.business).toMatchObject({
      businessName: 'Warung Mak Cik',
      category: 'Restaurant',
      productsServices: ['Rendang', 'Nasi campur'],
      bestSellers: ['Nasi campur', 'rendang'],
      targetAudience: 'Office workers and families in Bangsar',
      location: 'Kuala Lumpur, Wilayah Persekutuan',
      tone: 'Warm and homely',
      tagline: 'Home-style Malay food',
    })
    expect(dna.brand).toMatchObject({
      logoCandidate: null,
      colors: [],
      typography: { detectedFont: 'Plus Jakarta Sans', supportedMatch: null, source: 'website', confidence: 'high' },
      visualStyle: 'Warm food photography',
      styleTraits: ['warm', 'rustic'],
      suggestedTraits: ['warm', 'traditional'],
      visualMood: 'Homely',
      confidence: 'medium',
    })
    expect(dna.unknowns).toEqual(['Price range'])
    expect(JSON.stringify(dna)).not.toContain('brandKit')
  })

  it('falls back to the analysis brand style and the markup font when the model saw no images', () => {
    const dna = buildBusinessDna(
      input({
        websiteVisual: { colors: [], logoUrl: null, fontFamily: 'Poppins', fontName: 'Poppins' },
      }),
    )
    expect(dna.brand.visualStyle).toBe('Rustic, food-photography led')
    expect(dna.brand.typography).toEqual({ detectedFont: 'Poppins', supportedMatch: 'Poppins', source: 'website', confidence: 'high' })
    expect(dna.brand.typography?.detectedFont).toBe('Poppins')
  })

  it('leaves typography null when nothing named a font', () => {
    expect(buildBusinessDna(input()).brand.typography).toBeNull()
  })

  it('maps source status to categorical confidence', () => {
    expect(confidenceFor('analyzed')).toBe('high')
    expect(confidenceFor('limited')).toBe('medium')
    expect(confidenceFor('inaccessible')).toBe('low')
    expect(confidenceFor('failed')).toBe('low')
  })
})

describe('through the existing brain merge (7D.1 / 7D.2 preserved)', () => {
  it('a social-only run stamps the brain with the Facebook Page and fills visual slots on the claim', () => {
    const merged = input({
      sources: sources([{ type: 'facebook', reference: FACEBOOK }]),
      visuals: [visual({ id: 'img1', role: 'logo_candidate', sourceType: 'facebook', ref: 'https://scontent.example.com/pic.jpg' })],
      analysis: dnaAnalysis({}, { logoImageId: 'img1', colors: [{ hex: '#c0392b', confidence: 'medium', seenIn: 'img1' }] }),
    })
    const stamp = primarySource(merged.sources)
    expect(stamp).toEqual({ kind: 'facebook', reference: FACEBOOK })

    const patch = mergeWebsiteAnalysis(emptyBrain(), merged.analysis, {
      websiteUrl: stamp!.reference,
      pagesAnalysed: 1,
      now: NOW,
      source: stamp!.kind,
      brandVisual: toBrandVisual(merged),
    })
    const brand = fillEmptyBrandVisuals(patch.brand ?? null, toBrandVisual(merged))
    expect(brand?.value.logoUrl).toBe('https://scontent.example.com/pic.jpg')
    expect(brand?.value.colors).toEqual([{ label: 'Facebook', hex: '#c0392b' }])
    expect(patch.contact?.website).toBeNull()
    expect(patch.contact?.socialProfiles?.[0]?.url).toBe(FACEBOOK)
    expect(patch.brandKit).toBeUndefined()
  })

  it('an Assets-only run stamps the brain as document with no URL anywhere', () => {
    const merged = input({ sources: sources([{ type: 'asset', reference: null, count: 2 }]) })
    const stamp = primarySource(merged.sources)!
    const patch = mergeWebsiteAnalysis(emptyBrain(), merged.analysis, {
      websiteUrl: stamp.reference,
      pagesAnalysed: 0,
      now: NOW,
      source: stamp.kind,
      brandVisual: toBrandVisual(merged),
    })
    expect(patch.sources?.map((s) => [s.id, s.reference])).toEqual([['document', ASSETS_SOURCE_REF]])
    expect(patch.contact?.website).toBeNull()
    expect(patch.contact?.socialProfiles).toEqual([])
    expect(patch.brandKit).toBeUndefined()
  })
})
