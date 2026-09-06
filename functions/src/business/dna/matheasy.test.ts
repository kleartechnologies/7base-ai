import { describe, expect, it } from 'vitest'
import {
  applyDetectedBrand,
  detectedBrandSuggestion,
} from '@/features/business/brand/brandKit'
import type { Business } from '@/types'
import type { StoredBusiness } from '../../lib/business.types'
import { fillEmptyBrandVisuals, mergeWebsiteAnalysis } from '../brain/merge'
import { extractBrandVisual } from '../website/brandVisual'
import { parseRequest } from '../analyzeDna'
import {
  assetEvidence,
  EvidenceIds,
  selectVisualCandidates,
  websiteEvidence,
  type VisualEvidence,
} from './evidence'
import { analysis, asset, emptyBrain, NOW, site } from './fixtures'
import {
  buildBusinessDna,
  primarySource,
  stampAdditionalSources,
  toBrandVisual,
  type DnaMergeInput,
} from './merge'
import { validateBusinessDna } from './validate'

/**
 * Regression for the production Matheasy state of 6 Sep 2026: a business
 * whose semantic brand the owner confirmed, whose Brand Kit holds an official
 * logo Asset and nothing else, and whose website markup declares
 * `theme-color: #22c55e`, an apple-touch-icon and Plus Jakarta Sans.
 *
 * The whole path runs for real except the model call, which is replaced by a
 * schema-shaped reply: markup → 7D.1 extractor → evidence → validator → merge
 * → business document → client suggestion → "Use these".
 */

const BUSINESS_ID = 'biz_matheasy'
const OWNER_ID = 'owner_matheasy'
const LOGO_ASSET_ID = 'asset_matheasy_logo'
const WEBSITE = 'https://www.getmatheasy.com/'

const MATHEASY_HTML = `<!doctype html><html lang="en"><head>
<meta charset="utf-8">
<title>Matheasy — Scan. Solve. Understand.</title>
<meta name="description" content="Snap a photo of any maths problem and get a step-by-step explanation.">
<meta name="theme-color" content="#22c55e">
<link rel="apple-touch-icon" href="/assets/apple-touch-icon.png">
<link rel="icon" href="/assets/icon-512.png">
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;700&display=swap" rel="stylesheet">
<style>body{font-family:'Plus Jakarta Sans',sans-serif}</style>
</head><body>
<header><img src="/assets/logo-w.png" alt="Matheasy"></header>
<h1>Scan. Solve. Understand.</h1>
<p>Matheasy explains every step so students actually learn.</p>
<img src="/assets/scanner-w.jpg" alt="Scanning a worksheet">
</body></html>`

/** The confirmed semantic brand claim exactly as the owner left it. */
function confirmedBrand(): NonNullable<StoredBusiness['brand']> {
  return {
    value: {
      voice: 'Clear, encouraging, student-first',
      personalityTraits: ['Helpful', 'Patient'],
      colors: [],
      logoUrl: null,
      fontFamily: null,
      visualStyle: 'Clean app-style layout with lots of white space',
      keyMessages: ['Scan. Solve. Understand.'],
      valuePropositions: ['Step-by-step explanations, not just answers'],
    },
    source: 'website',
    sourceRef: WEBSITE,
    confidence: 0.6,
    confirmed: true,
    discoveredAt: NOW - 100_000,
    confirmedAt: NOW - 50_000,
  }
}

function brandKit(): NonNullable<StoredBusiness['brandKit']> {
  return {
    logoAssetId: LOGO_ASSET_ID,
    colors: { primary: null, secondary: null, accent: null },
    typography: { heading: null, body: null },
    styleTraits: [],
    styleNotes: null,
    notes: null,
    updatedAt: NOW - 40_000,
  }
}

/** The production document before any Phase 7E run: analysed on 5 Sep, pre-7D.1. */
function matheasy(): StoredBusiness {
  return emptyBrain({
    ownerId: OWNER_ID,
    name: 'Matheasy',
    industry: 'other',
    identity: {
      legalName: null,
      tagline: 'Scan. Solve. Understand.',
      description: 'Snap a photo of any maths problem and get a step-by-step explanation.',
      category: 'Education app',
      subIndustry: null,
      businessType: null,
      foundedYear: null,
    },
    contact: { email: null, phone: null, whatsapp: null, website: WEBSITE, socialProfiles: [] },
    brand: confirmedBrand(),
    brandKit: brandKit(),
    sources: [
      {
        id: 'website',
        kind: 'website',
        label: 'getmatheasy.com',
        reference: WEBSITE,
        status: 'connected',
        lastSyncedAt: NOW - 100_000,
      },
    ],
    discovery: {
      status: 'complete',
      stage: null,
      lastRunAt: NOW - 100_000,
      completedAt: NOW - 100_000,
      sourceRef: WEBSITE,
      pagesAnalysed: 1,
      error: null,
      errorCode: null,
      summary: 'A maths learning app.',
      unknowns: [],
    },
  })
}

function logoAsset() {
  return {
    id: LOGO_ASSET_ID,
    asset: asset({
      ownerId: OWNER_ID,
      businessId: BUSINESS_ID,
      type: 'logo',
      name: 'Matheasy logo',
      fileName: 'logo.png',
      contentType: 'image/png',
      storagePath: `businesses/${BUSINESS_ID}/assets/${LOGO_ASSET_ID}/logo.png`,
      tags: [],
    }),
  }
}

/** The client's view of the document after a server write. */
function asClientBusiness(doc: StoredBusiness): Business {
  return { id: BUSINESS_ID, ...doc } as unknown as Business
}

/** Runs the DNA pipeline with a schema-shaped model reply; returns the stored doc after. */
function runDnaPipeline(stored: StoredBusiness) {
  const visual = extractBrandVisual(WEBSITE, MATHEASY_HTML)
  const ids = new EvidenceIds()
  const page = site({
    startUrl: WEBSITE,
    pageUrls: [WEBSITE],
    corpus: 'Matheasy. Scan. Solve. Understand. Step-by-step maths explanations for students.',
    signals: {
      emails: [],
      phones: [],
      socialLinks: [],
      images: [`${WEBSITE}assets/logo-w.png`, `${WEBSITE}assets/scanner-w.jpg`],
    },
  })
  const web = websiteEvidence({ site: page, visual, canonicalUrl: WEBSITE }, ids)
  const uploaded = assetEvidence([logoAsset()], ids)
  const evidence = [...web.evidence, ...uploaded.evidence]
  const candidates = selectVisualCandidates([...web.visuals, ...uploaded.visuals])
  const visuals: VisualEvidence[] = candidates.map((candidate, index) => ({
    ...candidate,
    id: `img${index + 1}`,
    contentType: 'image/png',
    dataUrl: 'data:image/png;base64,AAAA',
  }))
  const assetImage = visuals.find((item) => item.assetId === LOGO_ASSET_ID)!

  // What the model returns for this evidence, in the strict schema's shape.
  const reply = {
    ...analysis({
      identity: {
        businessName: 'Matheasy',
        legalName: null,
        tagline: 'Scan. Solve. Understand.',
        description: 'A maths learning app that explains every step.',
        category: 'Education app',
        subIndustry: null,
        businessType: null,
        industry: 'other',
      },
      products: [],
      brand: {
        voice: 'Clear and encouraging',
        personalityTraits: ['Helpful'],
        visualStyle: 'Green accent on white, app-style',
        keyMessages: ['Scan. Solve. Understand.'],
        valuePropositions: [],
        sourceUrl: WEBSITE,
        confidence: 0.7,
      },
      unknowns: [],
      summary: 'Matheasy is a maths learning app.',
    }),
    brandDna: {
      logoImageId: assetImage.id,
      colors: [
        { hex: '#22C55E', seenIn: 'img1', confidence: 'high' },
        { hex: '#111827', seenIn: 'img2', confidence: 'medium' },
      ],
      detectedFont: 'plus jakarta sans',
      typographyNotes: null,
      visualStyle: 'Bright green accent on clean white, rounded app UI',
      styleTraits: ['modern', 'friendly', 'clean'],
      imageryStyle: null,
      compositionStyle: null,
      visualMood: null,
      confidence: 'high',
    },
  }

  const validated = validateBusinessDna(reply, {
    imageIds: visuals.map((item) => item.id),
    fontNames: evidence.filter((item) => item.kind === 'font').map((item) => item.value),
  })
  const sources = [
    { type: 'website' as const, reference: WEBSITE, status: 'analyzed' as const, count: 1 },
    { type: 'asset' as const, reference: null, status: 'analyzed' as const, count: 1 },
  ]
  const mergeInput: DnaMergeInput = {
    analysis: validated,
    sources,
    evidence,
    visuals,
    websiteVisual: visual,
    now: NOW,
  }
  const primary = primarySource(sources)!
  const patch = stampAdditionalSources(
    mergeWebsiteAnalysis(stored, validated, {
      websiteUrl: primary.reference,
      pagesAnalysed: 1,
      now: NOW,
      source: primary.kind,
      brandVisual: toBrandVisual(mergeInput),
    }),
    stored,
    [],
    NOW,
  )
  const dna = buildBusinessDna(mergeInput)
  const after: StoredBusiness = {
    ...stored,
    ...patch,
    discovery: { ...stored.discovery, status: 'complete', completedAt: NOW, dna },
    updatedAt: NOW,
  }
  return { visual, validated, patch, dna, after }
}

describe('Matheasy: confirmed semantic brand, empty visuals, official logo, #22c55e on the site', () => {
  it('the request the sources card sent (links omitted or null) is accepted', () => {
    // The Firebase client SDK serialises `links: undefined` as `null`; the
    // production run on 6 Sep 2026 was refused with invalid-argument for it.
    expect(parseRequest({ businessId: BUSINESS_ID, links: null })).toEqual({ businessId: BUSINESS_ID, links: [] })
    expect(parseRequest({ businessId: BUSINESS_ID })).toEqual({ businessId: BUSINESS_ID, links: [] })
    expect(parseRequest({ businessId: BUSINESS_ID, links: [] })).toEqual({ businessId: BUSINESS_ID, links: [] })
    expect(parseRequest({ businessId: BUSINESS_ID, links: [' https://www.facebook.com/matheasy '] })).toEqual({
      businessId: BUSINESS_ID,
      links: ['https://www.facebook.com/matheasy'],
    })
    expect(() => parseRequest({ businessId: BUSINESS_ID, links: 'nope' })).toThrow(/list of page addresses/)
    expect(() => parseRequest({ links: [] })).toThrow(/businessId/)
    expect(() => parseRequest({ businessId: BUSINESS_ID, brandKit: {}, links: [1] })).toThrow(/valid website/)
  })

  it('before any re-run there is no colour, logo or font to offer — what production displayed', () => {
    // The 5 Sep analysis predates the 7D.1 extractor, so the confirmed claim
    // has empty visual slots; only its style sentence is left to show.
    const suggestion = detectedBrandSuggestion(asClientBusiness(matheasy()))
    expect(suggestion).toMatchObject({ colors: [], logoUrl: null, logoAssetId: null, fontFamily: null })
  })

  it('the 7D.1 extractor reads #22c55e, the touch icon and the raw font from the markup', () => {
    const visual = extractBrandVisual(WEBSITE, MATHEASY_HTML)
    expect(visual).toEqual({
      colors: [{ label: 'Theme color', hex: '#22c55e' }],
      logoUrl: `${WEBSITE}assets/apple-touch-icon.png`,
      fontFamily: null,
      fontName: 'Plus Jakarta Sans',
    })
  })

  it('DNA run: semantic claim byte-for-byte intact, visuals filled, Brand Kit untouched', () => {
    const stored = matheasy()
    const { patch, dna, after } = runDnaPipeline(stored)

    // Confirmed semantic data survives exactly.
    const semantic = (brand: StoredBusiness['brand']) => {
      const { colors: _c, logoUrl: _l, fontFamily: _f, ...rest } = brand!.value
      const { value: _v, ...wrapper } = brand!
      return JSON.stringify({ rest, wrapper })
    }
    expect(semantic(after.brand)).toBe(semantic(confirmedBrand()))
    expect(after.identity.tagline).toBe('Scan. Solve. Understand.')
    expect(after.brand?.confirmed).toBe(true)

    // 7D.2: the empty visual slots of the confirmed claim are filled.
    expect(after.brand?.value.colors[0]).toEqual({ label: 'Theme color', hex: '#22c55e' })
    // The brain claim records the markup's icon as a candidate URL (7D.1); the
    // DNA report below points at the owner's Asset instead. Neither is applied.
    expect(after.brand?.value.logoUrl).toBe(`${WEBSITE}assets/apple-touch-icon.png`)
    expect(after.brand?.value.fontFamily).toBeNull() // Plus Jakarta Sans is not on the closed list

    // Discovery never writes the kit.
    expect(patch.brandKit).toBeUndefined()
    expect(after.brandKit).toEqual(brandKit())

    // The DNA report carries the richer detection honestly.
    expect(dna.brand.colors[0]).toEqual({ hex: '#22c55e', confidence: 'high', provenance: 'extracted', source: 'website' })
    expect(dna.brand.colors.map((color) => color.hex)).toEqual(['#22c55e', '#111827'])
    expect(dna.brand.logoCandidate).toMatchObject({ kind: 'asset', assetId: LOGO_ASSET_ID, url: null })
    expect(dna.brand.typography).toMatchObject({ detectedFont: 'Plus Jakarta Sans', supportedMatch: null })
    expect(dna.brand.suggestedTraits).toEqual(['modern', 'friendly', 'minimal'])
    expect(dna.sources.map((source) => `${source.type}:${source.status}`)).toEqual(['website:analyzed', 'asset:analyzed'])
  })

  it('client: the detected card shows #22c55e and the font; the confirmed logo is not re-offered', () => {
    const { after } = runDnaPipeline(matheasy())
    const suggestion = detectedBrandSuggestion(asClientBusiness(after))
    expect(suggestion).not.toBeNull()
    expect(suggestion).toMatchObject({
      colors: ['#22c55e', '#111827'],
      logoAssetId: null,
      logoUrl: null,
      fontFamily: 'Plus Jakarta Sans',
      supportedFont: null,
      traits: ['modern', 'friendly', 'minimal'],
      category: 'Education app',
      source: 'sources',
      unknown: [],
    })
  })

  it('client: colours alone are enough to show the card when the site names nothing else', () => {
    const { after } = runDnaPipeline(matheasy())
    const dna = after.discovery.dna!
    const only = {
      ...after,
      discovery: {
        ...after.discovery,
        dna: {
          ...dna,
          brand: { ...dna.brand, logoCandidate: null, typography: null, visualStyle: null, suggestedTraits: [] },
        },
      },
    }
    const suggestion = detectedBrandSuggestion(asClientBusiness(only))
    expect(suggestion?.colors).toEqual(['#22c55e', '#111827'])
    expect(suggestion?.unknown).toEqual(['typography', 'style'])
  })

  it('"Use these" writes the primary colour and nothing the owner already set', () => {
    const { after } = runDnaPipeline(matheasy())
    const before = JSON.stringify(after.brandKit)
    const suggestion = detectedBrandSuggestion(asClientBusiness(after))!
    const next = applyDetectedBrand(after.brandKit!, suggestion, NOW)

    expect(JSON.stringify(after.brandKit)).toBe(before) // untouched until the owner confirms
    expect(next.colors).toEqual({ primary: '#22c55e', secondary: '#111827', accent: null })
    expect(next.logoAssetId).toBe(LOGO_ASSET_ID)
    expect(next.typography).toEqual({ heading: null, body: null }) // no silent Plus Jakarta Sans → Inter
    expect(next.styleTraits).toEqual(['modern', 'friendly', 'minimal'])
    expect(next.styleNotes).toBe('Bright green accent on clean white, rounded app UI')

    // Once applied, the card goes quiet for those slots. The font stays a
    // visible hint until the owner picks an approved face — it was never applied.
    const applied = detectedBrandSuggestion(asClientBusiness({ ...after, brandKit: next }))
    expect(applied).toMatchObject({ colors: [], traits: [], visualStyle: null, fontFamily: 'Plus Jakarta Sans', supportedFont: null })
  })

  it('legacy website re-run (no DNA) also surfaces #22c55e through the 7D.2 fill', () => {
    const stored = matheasy()
    const visual = extractBrandVisual(WEBSITE, MATHEASY_HTML)
    const patch = mergeWebsiteAnalysis(stored, analysis({ products: [] }), {
      websiteUrl: WEBSITE,
      pagesAnalysed: 1,
      now: NOW,
      source: 'website',
      brandVisual: visual,
    })
    expect(patch.brand).toBe(fillEmptyBrandVisuals(patch.brand ?? null, visual))
    expect(patch.brand?.confirmed).toBe(true)
    expect(patch.brand?.value.colors).toEqual([{ label: 'Theme color', hex: '#22c55e' }])
    expect(patch.brandKit).toBeUndefined()

    const suggestion = detectedBrandSuggestion(asClientBusiness({ ...stored, ...patch }))
    expect(suggestion).toMatchObject({ colors: ['#22c55e'], logoUrl: null, fontFamily: null, source: 'website' })
  })
})
