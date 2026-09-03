import { describe, expect, it } from 'vitest'
import {
  AnalysisValidationError,
  InsufficientContentError,
  assertAnalysisUseful,
  confidence,
  validateWebsiteAnalysis,
} from './validate'

/**
 * The model's output is not trusted just because it came back as JSON. These
 * tests cover the two ways it goes wrong in practice: fields that are the
 * wrong shape, and fields that quietly assert something the website never
 * said.
 */

function minimalAnalysis(overrides: Record<string, unknown> = {}) {
  return {
    identity: { businessName: 'Warung Pak Din', description: 'Home-style Malay food.' },
    products: [],
    ...overrides,
  }
}

describe('validateWebsiteAnalysis', () => {
  it('refuses anything that is not an object', () => {
    for (const raw of ['{}', 42, null, [], undefined]) {
      expect(() => validateWebsiteAnalysis(raw)).toThrow(AnalysisValidationError)
    }
  })

  it('fills every section even when the model omitted them', () => {
    const result = validateWebsiteAnalysis(minimalAnalysis())

    expect(result.identity.businessName).toBe('Warung Pak Din')
    expect(result.location.city).toBeNull()
    expect(result.contact.socialProfiles).toEqual([])
    expect(result.audience.customerTypes).toEqual([])
    expect(result.unknowns).toEqual([])
    expect(result.summary).toBe('')
  })

  it('treats "unknown" as an absent answer, not a value', () => {
    const result = validateWebsiteAnalysis(
      minimalAnalysis({
        location: { city: 'Unknown', state: 'N/A', openingHours: 'not stated' },
      }),
    )

    expect(result.location.city).toBeNull()
    expect(result.location.state).toBeNull()
    expect(result.location.openingHours).toBeNull()
  })

  it('drops values of the wrong type instead of storing them', () => {
    const result = validateWebsiteAnalysis(
      minimalAnalysis({
        identity: { businessName: 'Warung Pak Din', tagline: { nested: true }, category: 42 },
        audience: { customerTypes: 'families' },
      }),
    )

    expect(result.identity.tagline).toBeNull()
    expect(result.identity.category).toBeNull()
    expect(result.audience.customerTypes).toEqual([])
  })

  it('collapses whitespace and truncates runaway text', () => {
    const result = validateWebsiteAnalysis(
      minimalAnalysis({
        identity: { businessName: '  Warung   Pak\nDin  ', description: 'x'.repeat(2000) },
      }),
    )

    expect(result.identity.businessName).toBe('Warung Pak Din')
    expect(result.identity.description?.length).toBeLessThanOrEqual(1201)
    expect(result.identity.description?.endsWith('…')).toBe(true)
  })

  it('de-duplicates list items', () => {
    const result = validateWebsiteAnalysis(
      minimalAnalysis({ audience: { customerTypes: ['Families', 'families', ' FAMILIES ', 'Students'] } }),
    )

    expect(result.audience.customerTypes).toEqual(['Families', 'Students'])
  })

  it('normalises prices, currency and product provenance', () => {
    const result = validateWebsiteAnalysis(
      minimalAnalysis({
        products: [
          {
            name: 'Nasi lemak ayam',
            price: 12.9,
            currency: 'RM',
            isSignature: true,
            sourceUrl: 'https://warungpakdin.com/menu',
            confidence: 0.9,
          },
          { name: '', price: 5 },
          { name: 'Teh tarik', price: 'free', currency: 'ringgit' },
        ],
      }),
    )

    expect(result.products).toHaveLength(2)
    expect(result.products[0]?.currency).toBe('MYR')
    expect(result.products[0]?.price).toBe(12.9)
    expect(result.products[0]?.isSignature).toBe(true)
    expect(result.products[1]?.price).toBeNull()
    expect(result.products[1]?.currency).toBe('MYR')
  })

  it('keeps only contact details that are actually well formed', () => {
    const result = validateWebsiteAnalysis(
      minimalAnalysis({ contact: { email: 'not-an-email', phone: '03-2201 1188' } }),
    )

    expect(result.contact.email).toBeNull()
    // Stored in a single canonical form so two spellings are never two numbers.
    expect(result.contact.phone).toBe('0322011188')
  })

  it('refuses source stamps for fields that are not in the provenance list', () => {
    const result = validateWebsiteAnalysis(
      minimalAnalysis({
        fieldSources: [
          { field: 'identity.category', confidence: 0.9 },
          { field: 'products.0.margin', confidence: 1 },
          { field: 'ownerId', confidence: 1 },
        ],
      }),
    )

    expect(result.fieldSources.map((entry) => entry.field)).toEqual(['identity.category'])
  })
})

describe('confidence', () => {
  it('clamps into 0–1', () => {
    expect(confidence(1.7)).toBe(1)
    expect(confidence(-3)).toBe(0)
    expect(confidence(0.834)).toBe(0.83)
  })

  it('defaults to unsure rather than certain when the model omits it', () => {
    expect(confidence(undefined)).toBe(0.5)
    expect(confidence('very high')).toBe(0.5)
    expect(confidence(null)).toBe(0.5)
  })
})

describe('assertAnalysisUseful', () => {
  it('accepts an analysis with a name and something to say', () => {
    expect(() => assertAnalysisUseful(validateWebsiteAnalysis(minimalAnalysis()))).not.toThrow()
  })

  it('rejects a well-formed analysis that is entirely empty', () => {
    const empty = validateWebsiteAnalysis({ identity: { businessName: 'Parked Domain' } })
    expect(() => assertAnalysisUseful(empty)).toThrow(InsufficientContentError)
  })

  it('rejects an analysis with no business name', () => {
    const nameless = validateWebsiteAnalysis({ identity: { description: 'Some food.' } })
    expect(() => assertAnalysisUseful(nameless)).toThrow(InsufficientContentError)
  })
})
