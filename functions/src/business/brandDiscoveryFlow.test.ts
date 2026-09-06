import { describe, expect, it } from 'vitest'

import {
  applyDetectedBrand,
  detectedBrandSuggestion,
  emptyBrandKit,
} from '@/features/business/brand/brandKit'
import type { Business as ClientBusiness } from '@/types'
import type { StoredBusiness } from '../lib/business.types'
import { mergeWebsiteAnalysis } from './brain/merge'
import type { WebsiteAnalysis } from './brain/validate'
import { extractBrandVisual, type BrandVisual } from './website/brandVisual'

/**
 * Phase 7D.1 end-to-end: one realistic homepage travels the whole road —
 * deterministic extraction → discovery merge → the client's detected-brand
 * suggestion → "Use these" → the owner's Brand Kit.
 *
 * This is the test the original Phase 7D was missing. Its unit tests each
 * hand-authored the shape they expected from the other side, so a discovery
 * pipeline that never produced colors/logoUrl/fontFamily and a card gate that
 * demanded them could both pass while no card ever rendered in production.
 * Here the producer's real output feeds the consumer's real input; a mismatch
 * anywhere on the chain fails loudly.
 *
 * (Vitest compiles both trees with the `@` alias, so the client module is
 * imported directly. The two `Discovered<BrandProfile>` shapes are mirrors of
 * one another; the cast below is between structurally identical types.)
 */

const NOW = 1_800_000_000_000

/** Close to what a real SME homepage head looks like — not a minimal stub. */
const HOMEPAGE_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Warung Mak Cik — Home-style Malay food in Bangsar</title>
  <meta name="description" content="Nasi campur, rendang and sambal made daily.">
  <meta property="og:title" content="Warung Mak Cik">
  <meta property="og:image" content="https://warungmakcik.com/img/storefront-photo.jpg">
  <meta name="theme-color" content="#1a7f5a">
  <link rel="apple-touch-icon" sizes="180x180" href="/icons/apple-touch-icon.png">
  <link rel="icon" type="image/png" sizes="32x32" href="/icons/favicon-32.png">
  <link rel="shortcut icon" href="/favicon.ico">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&display=swap">
  <style>
    :root {
      --brand-primary: #1a7f5a;
      --brand-accent: #c0392b;
      --page-background: #ffffff;
    }
    body { font-family: 'Poppins', system-ui, sans-serif; margin: 0; }
  </style>
</head>
<body>
  <header><img src="/img/logo.png" alt="Warung Mak Cik"></header>
  <main><h1>Home-style Malay food</h1><p>Open daily 8am – 9pm.</p></main>
</body>
</html>`

function analysis(over: Partial<WebsiteAnalysis> = {}): WebsiteAnalysis {
  return {
    identity: {
      businessName: 'Warung Mak Cik',
      legalName: null,
      tagline: 'Home-style Malay food',
      description: 'A neighbourhood warung in Bangsar serving nasi campur.',
      category: 'Restaurant',
      subIndustry: null,
      businessType: null,
      industry: 'food_and_beverage',
    },
    location: {
      addressLine1: null,
      city: 'Kuala Lumpur',
      state: null,
      postcode: null,
      countryCode: 'MY',
      serviceArea: null,
      openingHours: null,
    },
    contact: { email: null, phone: null, whatsapp: null, socialProfiles: [] },
    products: [],
    audience: {
      summary: null,
      customerTypes: [],
      demographics: [],
      useCases: [],
      needs: [],
      preferences: [],
      segments: [],
      sourceUrl: null,
      confidence: 0,
    },
    brand: {
      voice: 'Warm and homely',
      personalityTraits: ['Homely'],
      visualStyle: 'Rustic, food-photography led',
      keyMessages: [],
      valuePropositions: [],
      sourceUrl: null,
      confidence: 0.5,
    },
    marketing: {
      positioning: null,
      valueProposition: null,
      differentiators: [],
      activeChannels: [],
      promotions: [],
      callsToAction: [],
      themes: [],
      emphasizedProducts: [],
      sourceUrl: null,
      confidence: 0,
    },
    operations: {
      openingHours: null,
      orderingMethods: [],
      deliveryPlatforms: [],
      reservations: null,
      notes: [],
      sourceUrl: null,
      confidence: 0,
    },
    fieldSources: [],
    unknowns: [],
    summary: 'A Malay warung in Bangsar.',
    ...over,
  }
}

function emptyBrain(over: Partial<StoredBusiness> = {}): StoredBusiness {
  return {
    ownerId: 'owner_1',
    name: 'Untitled business',
    industry: 'other',
    identity: {
      legalName: null,
      tagline: null,
      description: null,
      category: null,
      subIndustry: null,
      businessType: null,
      foundedYear: null,
    },
    contact: { email: null, phone: null, whatsapp: null, website: null, socialProfiles: [] },
    location: {
      addressLine1: null,
      addressLine2: null,
      city: null,
      state: null,
      postcode: null,
      countryCode: 'MY',
      openingHours: null,
      serviceArea: null,
    },
    products: [],
    audience: null,
    brand: null,
    marketing: null,
    operations: null,
    provenance: {},
    sources: [],
    discovery: {
      status: 'not_started',
      stage: null,
      lastRunAt: null,
      completedAt: null,
      sourceRef: null,
      pagesAnalysed: 0,
      error: null,
      errorCode: null,
      summary: null,
      unknowns: [],
    },
    brainVersion: 2,
    createdAt: 1,
    updatedAt: 1,
    ...over,
  }
}

/** The functions-side claim, viewed through the client's mirrored types. */
function asClientBusiness(
  brand: StoredBusiness['brand'],
  brandKit: ClientBusiness['brandKit'] = null,
): Pick<ClientBusiness, 'brand' | 'brandKit'> {
  return { brand: brand as unknown as ClientBusiness['brand'], brandKit }
}

describe('homepage → extraction → merge → suggestion → Use these → Brand Kit', () => {
  const visual = extractBrandVisual('https://warungmakcik.com/', HOMEPAGE_HTML)
  const patch = mergeWebsiteAnalysis(emptyBrain(), analysis(), {
    websiteUrl: 'https://warungmakcik.com/',
    pagesAnalysed: 4,
    now: NOW,
    source: 'website',
    brandVisual: visual,
  })

  it('the extractor reads the icon, colours and font the page declares', () => {
    expect(visual.logoUrl).toBe('https://warungmakcik.com/icons/apple-touch-icon.png')
    expect(visual.colors).toEqual([
      { label: 'Theme color', hex: '#1a7f5a' },
      { label: '--brand-accent', hex: '#c0392b' },
    ])
    expect(visual.fontFamily).toBe('Poppins')
  })

  it('the merged brain carries the visuals alongside the inferred brand text', () => {
    expect(patch.brand?.value).toMatchObject({
      voice: 'Warm and homely',
      visualStyle: 'Rustic, food-photography led',
      logoUrl: 'https://warungmakcik.com/icons/apple-touch-icon.png',
      fontFamily: 'Poppins',
      colors: [
        { label: 'Theme color', hex: '#1a7f5a' },
        { label: '--brand-accent', hex: '#c0392b' },
      ],
    })
    expect(patch.brand).toMatchObject({ source: 'inferred', confirmed: false })
  })

  it('discovery writes the brand claim, never the owner Brand Kit', () => {
    expect('brandKit' in patch).toBe(false)
  })

  it('the client card sees exactly what discovery produced', () => {
    const suggestion = detectedBrandSuggestion(asClientBusiness(patch.brand ?? null))
    expect(suggestion).toEqual({
      colors: ['#1a7f5a', '#c0392b'],
      logoUrl: 'https://warungmakcik.com/icons/apple-touch-icon.png',
      fontFamily: 'Poppins',
      visualStyle: 'Rustic, food-photography led',
      logoAssetId: null,
      supportedFont: null,
      traits: [],
      category: null,
      sources: [],
      unknown: [],
      // The brand section is an inferred claim (INFERRED_SECTIONS.brand), so
      // the card shows the generic "detected brand" title, not "from your
      // website" — the same provenance honesty as everywhere else.
      source: 'other',
    })
  })

  it('"Use these" seeds the kit with the discovered colours and style', () => {
    const suggestion = detectedBrandSuggestion(asClientBusiness(patch.brand ?? null))!
    const kit = applyDetectedBrand(emptyBrandKit(1), suggestion, NOW)
    expect(kit.colors).toEqual({ primary: '#1a7f5a', secondary: '#c0392b', accent: null })
    expect(kit.styleNotes).toBe('Rustic, food-photography led')
    // The font stays a hint and the logo becomes an Asset via its own flow —
    // neither is written here.
    expect(kit.typography).toEqual({ heading: null, body: null })
    expect(kit.logoAssetId).toBeNull()
  })
})

describe('the owner-confirmed brand is never overwritten by re-analysis', () => {
  it('a confirmed claim keeps every populated field; only empty visual slots fill (7D.2)', () => {
    const confirmed: StoredBusiness['brand'] = {
      value: {
        voice: 'Friendly, patient, clear and encouraging',
        personalityTraits: [],
        colors: [],
        logoUrl: null,
        fontFamily: null,
        visualStyle: 'Clean, modern and visual',
        keyMessages: [],
        valuePropositions: [],
      },
      source: 'inferred',
      sourceRef: 'https://warungmakcik.com/',
      confidence: 0.95,
      confirmed: true,
      discoveredAt: 10,
      confirmedAt: 20,
    }
    const patch = mergeWebsiteAnalysis(emptyBrain({ brand: confirmed }), analysis(), {
      websiteUrl: 'https://warungmakcik.com/',
      pagesAnalysed: 4,
      now: NOW,
      source: 'website',
      brandVisual: extractBrandVisual('https://warungmakcik.com/', HOMEPAGE_HTML),
    })
    // The claim itself — provenance wrapper and every semantic field — is the
    // owner's, byte for byte. The fresh analysis text never lands.
    expect(patch.brand).toMatchObject({
      source: 'inferred',
      sourceRef: 'https://warungmakcik.com/',
      confidence: 0.95,
      confirmed: true,
      discoveredAt: 10,
      confirmedAt: 20,
    })
    expect(patch.brand?.value.voice).toBe('Friendly, patient, clear and encouraging')
    expect(patch.brand?.value.visualStyle).toBe('Clean, modern and visual')
    // The visual slots the owner never filled take the extracted candidates.
    expect(patch.brand?.value.colors).toEqual([
      { label: 'Theme color', hex: '#1a7f5a' },
      { label: '--brand-accent', hex: '#c0392b' },
    ])
    expect(patch.brand?.value.logoUrl).toBe(
      'https://warungmakcik.com/icons/apple-touch-icon.png',
    )
    expect(patch.brand?.value.fontFamily).toBe('Poppins')
  })

  it('an unconfirmed prior claim is refreshed by a run that found visuals', () => {
    const prior: StoredBusiness['brand'] = {
      value: {
        voice: 'Warm',
        personalityTraits: [],
        colors: [],
        logoUrl: null,
        fontFamily: null,
        visualStyle: null,
        keyMessages: [],
        valuePropositions: [],
      },
      source: 'inferred',
      sourceRef: 'https://warungmakcik.com/',
      confidence: 0.95,
      confirmed: false,
      discoveredAt: 10,
      confirmedAt: null,
    }
    const patch = mergeWebsiteAnalysis(emptyBrain({ brand: prior }), analysis(), {
      websiteUrl: 'https://warungmakcik.com/',
      pagesAnalysed: 4,
      now: NOW,
      source: 'website',
      brandVisual: extractBrandVisual('https://warungmakcik.com/', HOMEPAGE_HTML),
    })
    expect(patch.brand?.value.logoUrl).toBe(
      'https://warungmakcik.com/icons/apple-touch-icon.png',
    )
    expect(patch.brand?.discoveredAt).toBe(NOW)
  })
})

describe('the stranded-visualStyle case (the production Matheasy shape)', () => {
  // Discovery found only a style description; the owner later uploaded a logo
  // by hand. Under the old all-or-nothing gate this card never rendered and
  // the discovered style was unreachable.
  const brand: StoredBusiness['brand'] = {
    value: {
      voice: 'Friendly and clear',
      personalityTraits: [],
      colors: [],
      logoUrl: null,
      fontFamily: null,
      visualStyle: 'Clean, modern and visual, using animated mathematical examples.',
      keyMessages: [],
      valuePropositions: [],
    },
    source: 'inferred',
    sourceRef: 'https://www.getmatheasy.com/',
    confidence: 0.95,
    confirmed: true,
    discoveredAt: 10,
    confirmedAt: 20,
  }
  const kitWithLogo = { ...emptyBrandKit(1), logoAssetId: 'asset_manual_logo' }

  it('the style now reaches the card even though the logo slot is taken', () => {
    const suggestion = detectedBrandSuggestion(asClientBusiness(brand, kitWithLogo))
    expect(suggestion).toEqual({
      colors: [],
      logoUrl: null,
      fontFamily: null,
      visualStyle: 'Clean, modern and visual, using animated mathematical examples.',
      logoAssetId: null,
      supportedFont: null,
      traits: [],
      category: null,
      sources: [],
      unknown: [],
      // 'inferred' is not one of the card's named platforms, so it renders
      // under the generic title.
      source: 'other',
    })
  })

  it('"Use these" carries the style into the kit without touching the logo', () => {
    const suggestion = detectedBrandSuggestion(asClientBusiness(brand, kitWithLogo))!
    const next = applyDetectedBrand(kitWithLogo, suggestion, NOW)
    expect(next.styleNotes).toBe(
      'Clean, modern and visual, using animated mathematical examples.',
    )
    expect(next.logoAssetId).toBe('asset_manual_logo')
    expect(next.colors).toEqual({ primary: null, secondary: null, accent: null })
  })

  it('goes quiet only when the owner has filled every slot the card covers', () => {
    const fullKit = {
      ...kitWithLogo,
      colors: { primary: '#123456', secondary: null, accent: null },
      typography: { heading: 'Inter' as const, body: null },
      styleNotes: 'Owner wrote their own style notes',
    }
    expect(detectedBrandSuggestion(asClientBusiness(brand, fullKit))).toBeNull()
  })
})

describe('confirmed brand + deterministic visuals (Phase 7D.2 regression)', () => {
  // The production Matheasy failure: a confirmed brand claim with empty visual
  // slots blocked the extracted colour and icon because the section merge is
  // atomic. Field-level fill lets discovery add candidates to empty slots
  // while everything populated — semantic or visual — stays the owner's.
  const MATHEASY_VISUAL: BrandVisual = {
    colors: [{ label: 'Theme color', hex: '#22c55e' }],
    logoUrl: 'https://www.getmatheasy.com/assets/apple-touch-icon.png',
    fontFamily: null,
  }

  function matheasyBrand(
    value: Partial<NonNullable<StoredBusiness['brand']>['value']> = {},
  ): NonNullable<StoredBusiness['brand']> {
    return {
      value: {
        voice: 'Friendly, patient, clear and encouraging',
        personalityTraits: ['Friendly', 'Patient', 'Supportive'],
        colors: [],
        logoUrl: null,
        fontFamily: null,
        visualStyle:
          'Clean, modern and visual, using animated mathematical examples, graphs, shapes and typeset equations.',
        keyMessages: ['Scan. Solve. Understand.'],
        valuePropositions: ['Instant step-by-step solutions'],
        ...value,
      },
      source: 'inferred',
      sourceRef: 'https://www.getmatheasy.com/',
      confidence: 0.95,
      confirmed: true,
      discoveredAt: 1788626928081,
      confirmedAt: 1788626986095,
    }
  }

  function merge(brand: StoredBusiness['brand'], visual = MATHEASY_VISUAL) {
    return mergeWebsiteAnalysis(emptyBrain({ brand }), analysis(), {
      websiteUrl: 'https://www.getmatheasy.com/',
      pagesAnalysed: 4,
      now: NOW,
      source: 'website',
      brandVisual: visual,
    })
  }

  it('A: empty colour and logo slots take the extracted values; style stays', () => {
    const patch = merge(matheasyBrand())
    expect(patch.brand?.value.colors).toEqual([{ label: 'Theme color', hex: '#22c55e' }])
    expect(patch.brand?.value.logoUrl).toBe(
      'https://www.getmatheasy.com/assets/apple-touch-icon.png',
    )
    expect(patch.brand?.value.fontFamily).toBeNull()
    expect(patch.brand?.value.visualStyle).toBe(matheasyBrand().value.visualStyle)
  })

  it('B: existing colours are never overwritten by discovery', () => {
    const patch = merge(matheasyBrand({ colors: [{ label: 'Owner', hex: '#123456' }] }))
    expect(patch.brand?.value.colors).toEqual([{ label: 'Owner', hex: '#123456' }])
  })

  it('C: an existing logo URL is never overwritten by discovery', () => {
    const patch = merge(matheasyBrand({ logoUrl: 'https://www.getmatheasy.com/owner-logo.png' }))
    expect(patch.brand?.value.logoUrl).toBe('https://www.getmatheasy.com/owner-logo.png')
  })

  it('D: an existing font is never overwritten by discovery', () => {
    const patch = merge(matheasyBrand({ fontFamily: 'Nunito' }), {
      ...MATHEASY_VISUAL,
      fontFamily: 'Poppins',
    })
    expect(patch.brand?.value.fontFamily).toBe('Nunito')
  })

  it('E: mixed partial state fills only the empty slots', () => {
    const patch = merge(
      matheasyBrand({ logoUrl: 'https://www.getmatheasy.com/owner-logo.png' }),
      { ...MATHEASY_VISUAL, fontFamily: 'Poppins' },
    )
    expect(patch.brand?.value.colors).toEqual([{ label: 'Theme color', hex: '#22c55e' }])
    expect(patch.brand?.value.logoUrl).toBe('https://www.getmatheasy.com/owner-logo.png')
    expect(patch.brand?.value.fontFamily).toBe('Poppins')
  })

  it('F: every confirmed semantic field and the claim wrapper stay byte-for-byte', () => {
    const before = matheasyBrand()
    const after = merge(matheasyBrand()).brand!
    expect(after.value.voice).toEqual(before.value.voice)
    expect(after.value.personalityTraits).toEqual(before.value.personalityTraits)
    expect(after.value.visualStyle).toEqual(before.value.visualStyle)
    expect(after.value.keyMessages).toEqual(before.value.keyMessages)
    expect(after.value.valuePropositions).toEqual(before.value.valuePropositions)
    // The provenance wrapper is untouched: the fill is not a re-confirmation
    // and not a fresh claim — timestamps, source and confidence all hold.
    const { value: _a, ...afterWrapper } = after
    const { value: _b, ...beforeWrapper } = before
    expect(afterWrapper).toEqual(beforeWrapper)
  })

  it('G: the filled claim reaches the card, and only "Use these" touches the kit', () => {
    const patch = merge(matheasyBrand())
    // Discovery still writes the brand claim only — never the Brand Kit.
    expect('brandKit' in patch).toBe(false)

    // Matheasy's real kit state: a manually uploaded logo, nothing else.
    const kit = { ...emptyBrandKit(1), logoAssetId: 'vGgldbI7TIO3tp54Ya1S' }
    const suggestion = detectedBrandSuggestion(asClientBusiness(patch.brand ?? null, kit))
    expect(suggestion?.colors).toEqual(['#22c55e'])
    // The owner's kit logo suppresses the discovered logo candidate.
    expect(suggestion?.logoUrl).toBeNull()
    expect(suggestion?.visualStyle).toBe(matheasyBrand().value.visualStyle)

    const next = applyDetectedBrand(kit, suggestion!, NOW)
    expect(next.colors.primary).toBe('#22c55e')
    expect(next.logoAssetId).toBe('vGgldbI7TIO3tp54Ya1S')
  })

  it('no visuals found means the confirmed claim is returned untouched', () => {
    const before = matheasyBrand()
    const patch = merge(matheasyBrand(), { colors: [], logoUrl: null, fontFamily: null })
    expect(patch.brand).toEqual(before)
  })
})
