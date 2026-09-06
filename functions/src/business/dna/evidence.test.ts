import { describe, expect, it } from 'vitest'

import {
  ASSET_METADATA_CAP,
  assetEvidence,
  EvidenceIds,
  evidenceChars,
  MAX_ASSET_METADATA,
  selectVisualCandidates,
  SOCIAL_CORPUS_CAP,
  socialEvidence,
  uniqueUrls,
  VISUAL_LIMITS,
  WEBSITE_CORPUS_CAP,
  websiteEvidence,
  type VisualCandidate,
} from './evidence'
import { asset, site, socialProfile } from './fixtures'

/**
 * Evidence building is deterministic code over material the server already
 * fetched. These tests pin the Phase 7E promises: every source reduces to
 * the same labelled shape, corpus and metadata are bounded here (not by the
 * model), image candidates come only from what a source exposed, and the
 * representative image set is chosen the same way every run.
 */

const WEBSITE_VISUAL = {
  colors: [{ label: 'Theme color', hex: '#1a7f5a' }],
  logoUrl: 'https://warungmakcik.com/icons/apple-touch-icon.png',
  fontFamily: 'Poppins' as const,
  fontName: 'Poppins',
}

describe('websiteEvidence', () => {
  it('reduces a crawled site to labelled evidence with stable ids', () => {
    const { evidence, visuals } = websiteEvidence({
      site: site(),
      visual: WEBSITE_VISUAL,
      canonicalUrl: 'https://warungmakcik.com/',
    })
    expect(evidence.map((item) => item.id)).toEqual(['e1', 'e2', 'e3', 'e4', 'e5'])
    expect(evidence.map((item) => item.kind)).toEqual(['text', 'meta', 'color', 'font', 'logo'])
    expect(evidence[0]).toMatchObject({
      sourceType: 'website',
      confidence: 'high',
      provenance: 'source_text',
      metadata: { pages: 2 },
    })
    expect(evidence[2]).toMatchObject({ value: '#1a7f5a', provenance: 'deterministic' })
    expect(evidence[3]).toMatchObject({ value: 'Poppins', metadata: { supportedMatch: 'Poppins' } })
    expect(evidence[4]).toMatchObject({ imageRef: WEBSITE_VISUAL.logoUrl, confidence: 'medium' })

    // The icon is the logo candidate; the OG image (first in signals) is the
    // hero; two more page images are representative — no more.
    expect(visuals.map((v) => [v.role, v.ref])).toEqual([
      ['logo_candidate', WEBSITE_VISUAL.logoUrl],
      ['hero', 'https://warungmakcik.com/img/storefront-photo.jpg'],
      ['representative', 'https://warungmakcik.com/img/rendang.jpg'],
      ['representative', 'https://warungmakcik.com/img/nasi-campur.jpg'],
    ])
  })

  it('keeps the raw font name when it is not on the approved list', () => {
    const { evidence } = websiteEvidence({
      site: site(),
      visual: { ...WEBSITE_VISUAL, fontFamily: null, fontName: 'Plus Jakarta Sans' },
      canonicalUrl: 'https://warungmakcik.com/',
    })
    const font = evidence.find((item) => item.kind === 'font')
    expect(font?.value).toBe('Plus Jakarta Sans')
    expect(font?.metadata).toEqual({})
  })

  it('caps the corpus and produces no image candidates without a visual', () => {
    const { evidence, visuals } = websiteEvidence({
      site: site({ corpus: 'x'.repeat(WEBSITE_CORPUS_CAP + 5_000), signals: { emails: [], phones: [], socialLinks: [], images: [] } }),
      visual: null,
      canonicalUrl: 'https://warungmakcik.com/',
    })
    expect(evidence).toHaveLength(1)
    expect(evidence[0]?.value).toHaveLength(WEBSITE_CORPUS_CAP)
    expect(visuals).toEqual([])
  })
})

describe('socialEvidence', () => {
  it('labels the profile as medium-confidence text and offers the picture as a logo candidate', () => {
    const { evidence, visuals } = socialEvidence({
      kind: 'facebook',
      profile: socialProfile(),
      canonicalUrl: 'https://www.facebook.com/warungmakcik',
    })
    expect(evidence[0]).toMatchObject({
      sourceType: 'facebook',
      kind: 'text',
      confidence: 'medium',
      provenance: 'source_text',
      metadata: { platform: 'Facebook Page' },
    })
    expect(evidence[1]?.value).toContain('https://wa.me/60123456789')
    expect(evidence[2]).toMatchObject({
      kind: 'image',
      imageRef: 'https://scontent.example.com/profile.jpg',
    })
    // Only the first image (the OG / profile picture), never the cover.
    expect(visuals).toEqual([
      expect.objectContaining({ role: 'logo_candidate', sourceType: 'facebook', ref: 'https://scontent.example.com/profile.jpg' }),
    ])
  })

  it('caps the social corpus and copes with a profile that exposed no page', () => {
    const { evidence, visuals } = socialEvidence({
      kind: 'instagram',
      profile: socialProfile({ corpus: 'y'.repeat(SOCIAL_CORPUS_CAP * 2), page: undefined, signals: { emails: [], phones: [], outboundLinks: [] } }),
      canonicalUrl: 'https://www.instagram.com/warungmakcik/',
    })
    expect(evidence).toHaveLength(1)
    expect(evidence[0]?.value).toHaveLength(SOCIAL_CORPUS_CAP)
    expect(visuals).toEqual([])
  })
})

describe('assetEvidence', () => {
  it('turns owner labels into high-confidence metadata and images into candidates', () => {
    const { evidence, visuals } = assetEvidence([
      { id: 'a_photo', asset: asset({ type: 'photo', name: 'Rendang plate', tags: ['food', 'rendang'] }) },
      { id: 'a_logo', asset: asset({ type: 'logo', name: 'Main logo', fileName: 'logo.png', contentType: 'image/png', tags: [] }) },
      { id: 'a_menu', asset: asset({ type: 'menu', name: 'Menu 2026', contentType: 'application/pdf', fileName: 'menu.pdf' }) },
    ])
    // Logo first, then photo, then the menu document.
    expect(evidence.map((item) => [item.assetId, item.kind])).toEqual([
      ['a_logo', 'image'],
      ['a_photo', 'image'],
      ['a_menu', 'document'],
    ])
    expect(evidence[0]).toMatchObject({
      sourceType: 'asset',
      confidence: 'high',
      provenance: 'asset_metadata',
      value: 'type: logo; name: Main logo',
    })
    expect(evidence[1]?.value).toBe('type: photo; name: Rendang plate; tags: food, rendang')
    // A PDF is never an image candidate.
    expect(visuals.map((v) => [v.role, v.assetId])).toEqual([
      ['logo_candidate', 'a_logo'],
      ['asset', 'a_photo'],
    ])
    expect(visuals[1]?.label).toContain('owner labelled it: photo')
  })

  it('bounds the metadata lines and each description', () => {
    const many = Array.from({ length: MAX_ASSET_METADATA + 5 }, (_, i) => ({
      id: `a_${i}`,
      asset: asset({ name: 'n'.repeat(500), createdAt: i }),
    }))
    const { evidence } = assetEvidence(many)
    expect(evidence).toHaveLength(MAX_ASSET_METADATA)
    for (const item of evidence) expect(item.value.length).toBeLessThanOrEqual(ASSET_METADATA_CAP)
  })
})

describe('selectVisualCandidates', () => {
  const candidate = (over: Partial<VisualCandidate>): VisualCandidate => ({
    role: 'representative',
    sourceType: 'website',
    ref: 'https://warungmakcik.com/img/x.jpg',
    assetId: null,
    assetType: null,
    label: 'x',
    ...over,
  })

  it('picks one logo, one hero, two representatives and up to three assets, in that order', () => {
    const chosen = selectVisualCandidates([
      candidate({ role: 'logo_candidate', sourceType: 'facebook', ref: 'https://fb/pic.jpg' }),
      candidate({ role: 'logo_candidate', ref: 'https://site/icon.png' }),
      candidate({ role: 'hero', ref: 'https://site/hero.jpg' }),
      candidate({ ref: 'https://site/1.jpg' }),
      candidate({ ref: 'https://site/2.jpg' }),
      candidate({ ref: 'https://site/3.jpg' }),
      candidate({ role: 'asset', sourceType: 'asset', ref: 'a1', assetId: 'a1', assetType: 'photo' }),
      candidate({ role: 'asset', sourceType: 'asset', ref: 'a2', assetId: 'a2', assetType: 'photo' }),
      candidate({ role: 'asset', sourceType: 'asset', ref: 'a3', assetId: 'a3', assetType: 'photo' }),
      candidate({ role: 'asset', sourceType: 'asset', ref: 'a4', assetId: 'a4', assetType: 'photo' }),
    ])
    expect(chosen.map((c) => c.ref)).toEqual([
      'https://site/icon.png', // website outranks facebook for the logo slot
      'https://site/hero.jpg',
      'https://site/1.jpg',
      'https://site/2.jpg',
      'a1',
      'a2',
    ])
    expect(chosen).toHaveLength(VISUAL_LIMITS.total)
  })

  it('a logo-typed Asset that lost the logo slot still reaches the model as an asset', () => {
    const chosen = selectVisualCandidates([
      candidate({ role: 'logo_candidate', ref: 'https://site/icon.png' }),
      candidate({ role: 'logo_candidate', sourceType: 'asset', ref: 'a_logo', assetId: 'a_logo', assetType: 'logo' }),
    ])
    expect(chosen.map((c) => c.ref)).toEqual(['https://site/icon.png', 'a_logo'])
  })

  it('is deterministic and de-duplicates by reference', () => {
    const input = [
      candidate({ role: 'hero', ref: 'https://site/same.jpg' }),
      candidate({ ref: 'https://site/same.jpg' }),
    ]
    expect(selectVisualCandidates(input)).toHaveLength(1)
    expect(selectVisualCandidates(input)).toEqual(selectVisualCandidates([...input].reverse()))
  })
})

describe('helpers', () => {
  it('EvidenceIds hands out e1, e2, … across builders', () => {
    const ids = new EvidenceIds()
    const a = websiteEvidence({ site: site(), visual: null, canonicalUrl: 'https://warungmakcik.com/' }, ids)
    const b = assetEvidence([{ id: 'a1', asset: asset() }], ids)
    expect(a.evidence.map((e) => e.id)).toEqual(['e1', 'e2'])
    expect(b.evidence.map((e) => e.id)).toEqual(['e3'])
  })

  it('uniqueUrls keeps only http(s) strings, once each', () => {
    expect(uniqueUrls(['https://a/1', ' https://a/1', 'data:image/png;base64,x', 'ftp://a', '', 'http://b'])).toEqual([
      'https://a/1',
      'http://b',
    ])
  })

  it('evidenceChars sums text lengths for the budget check', () => {
    const { evidence } = websiteEvidence({ site: site({ corpus: 'abc' }), visual: null, canonicalUrl: 'https://warungmakcik.com/' })
    expect(evidenceChars(evidence)).toBe(3 + (evidence[1]?.value.length ?? 0))
  })
})
