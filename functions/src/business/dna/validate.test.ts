import { describe, expect, it } from 'vitest'

import { analysis } from './fixtures'
import { mapTraits, validateBrandDna, validateBusinessDna } from './validate'

/**
 * The model's brandDna block is validated against the EVIDENCE, not just
 * its shape: a logo must be an attached image id, a colour must be brand-
 * like, a font must be one the markup named (kept as written, matched to
 * the approved list beside it, never silently mapped).
 */

const context = { imageIds: ['img1', 'img2'], fontNames: ['Plus Jakarta Sans', 'Poppins'] }

describe('validateBrandDna', () => {
  it('accepts a logo only when it is an attached image id', () => {
    expect(validateBrandDna({ logoImageId: 'img2' }, context).logoImageId).toBe('img2')
    expect(validateBrandDna({ logoImageId: 'img9' }, context).logoImageId).toBeNull()
    expect(validateBrandDna({ logoImageId: 'https://evil.example/logo.png' }, context).logoImageId).toBeNull()
    expect(validateBrandDna({ logoImageId: 'img1' }, { ...context, imageIds: [] }).logoImageId).toBeNull()
  })

  it('keeps brand-like colours, normalised, de-duplicated and capped at five', () => {
    const { colors } = validateBrandDna(
      {
        colors: [
          { hex: '#1A7F5A', confidence: 'high', seenIn: 'markup' },
          { hex: '#1a7f5a', confidence: 'low', seenIn: 'img1' },
          { hex: '#ffffff', confidence: 'high', seenIn: 'img1' },
          { hex: '#000', confidence: 'high', seenIn: 'img1' },
          { hex: 'not-a-colour', confidence: 'high', seenIn: 'img1' },
          { hex: '#c0392b', confidence: 'nonsense', seenIn: 'img2' },
          { hex: '#2980b9', confidence: 'medium', seenIn: 'img2' },
          { hex: '#8e44ad', confidence: 'medium', seenIn: 'img2' },
          { hex: '#f39c12', confidence: 'medium', seenIn: 'img2' },
          { hex: '#16a085', confidence: 'medium', seenIn: 'img2' },
        ],
      },
      context,
    )
    expect(colors.map((c) => c.hex)).toEqual(['#1a7f5a', '#c0392b', '#2980b9', '#8e44ad', '#f39c12'])
    expect(colors[0]).toEqual({ hex: '#1a7f5a', confidence: 'high', seenIn: 'markup' })
    // Unknown confidence degrades to low rather than being trusted.
    expect(colors[1]?.confidence).toBe('low')
  })

  it('only accepts a font the evidence named, keeps its spelling, records the approved match', () => {
    const unsupported = validateBrandDna({ detectedFont: 'plus jakarta sans' }, context)
    expect(unsupported.detectedFont).toBe('Plus Jakarta Sans')
    expect(unsupported.supportedFont).toBeNull()

    const supported = validateBrandDna({ detectedFont: 'POPPINS' }, context)
    expect(supported.detectedFont).toBe('Poppins')
    expect(supported.supportedFont).toBe('Poppins')

    // Guessed from a picture: the evidence never named it → null.
    const invented = validateBrandDna({ detectedFont: 'Montserrat' }, context)
    expect(invented.detectedFont).toBeNull()
    expect(invented.supportedFont).toBeNull()
  })

  it('bounds descriptions and traits, and maps traits onto the closed list without forcing', () => {
    const result = validateBrandDna(
      {
        visualStyle: 'v'.repeat(500),
        styleTraits: ['Warm', 'rustic', 'quirky', 'MODERN', 'x', 'y', 'z', 'too-many'],
        confidence: 'high',
      },
      context,
    )
    expect(result.visualStyle).toBe(`${'v'.repeat(160)}…`)
    expect(result.styleTraits).toHaveLength(6)
    expect(result.suggestedTraits).toEqual(['warm', 'traditional', 'modern'])
    expect(result.confidence).toBe('high')
  })

  it('tolerates a missing or malformed block', () => {
    const result = validateBrandDna({ colors: 'nope', styleTraits: 42, logoImageId: 7 }, context)
    expect(result).toMatchObject({ logoImageId: null, colors: [], detectedFont: null, styleTraits: [], confidence: 'low' })
  })
})

describe('validateBusinessDna', () => {
  it('validates the base analysis unchanged and attaches the brand block', () => {
    const raw = { ...analysis(), brandDna: { logoImageId: 'img1', colors: [], detectedFont: null, confidence: 'medium' } }
    const result = validateBusinessDna(raw, context)
    expect(result.identity.businessName).toBe('Warung Mak Cik')
    expect(result.brandDna.logoImageId).toBe('img1')
    expect(result.brandDna.confidence).toBe('medium')
  })

  it('survives a response with no brandDna at all', () => {
    const result = validateBusinessDna(analysis(), context)
    expect(result.brandDna.logoImageId).toBeNull()
    expect(result.brandDna.colors).toEqual([])
  })
})

describe('mapTraits', () => {
  it('maps synonyms, de-duplicates and caps at four', () => {
    expect(mapTraits(['luxury', 'premium', 'cosy', 'clean', 'corporate', 'playful'])).toEqual([
      'premium',
      'warm',
      'minimal',
      'professional',
    ])
    expect(mapTraits(['quirky', 'sassy'])).toEqual([])
  })
})
