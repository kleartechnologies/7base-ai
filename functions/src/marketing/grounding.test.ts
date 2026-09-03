import { describe, expect, it } from 'vitest'

import { emptyBrain } from '../business/brain/empty'
import type { Audience, Discovered, StoredBusiness } from '../lib/business.types'
import { assessBrainRichness, clampConfidence } from './grounding'

/**
 * Confidence must reflect evidence quality, not how confident the model
 * sounds. These tests pin the clamp: a sparse Brain can never yield a high-
 * confidence recommendation, and no Brain at all yields only 'low'.
 */

function discoveredAudience(confirmed: boolean): Discovered<Audience> {
  return {
    value: {
      summary: 'Families and office workers',
      segments: [],
      customerTypes: ['families'],
      demographics: [],
      useCases: [],
      needs: [],
      preferences: [],
    },
    source: 'website',
    sourceRef: 'https://example.my',
    confidence: 0.6,
    confirmed,
    discoveredAt: 1,
  }
}

function sparseBrain(): StoredBusiness {
  const brain = emptyBrain('owner', 'Warung Uji')
  brain.identity.description = 'A small mandi restaurant.'
  brain.products = [product('Chicken Mandi')]
  return brain
}

function groundedBrain(): StoredBusiness {
  const brain = sparseBrain()
  brain.identity.category = 'Restaurant'
  brain.location.city = 'Banting'
  brain.products = ['A', 'B', 'C', 'D', 'E'].map(product)
  brain.audience = discoveredAudience(true)
  return brain
}

function product(name: string): StoredBusiness['products'][number] {
  return {
    id: name,
    name,
    description: null,
    priceMinor: 1890,
    currency: 'MYR',
    category: null,
    imageUrl: null,
    isSignature: false,
    attributes: [],
    source: 'website',
    sourceRef: null,
    confidence: 0.9,
    confirmed: false,
  }
}

describe('assessBrainRichness', () => {
  it('no business at all is missing', () => {
    expect(assessBrainRichness(null)).toBe('missing')
  })

  it('a brand new brain with only a name is missing', () => {
    expect(assessBrainRichness(emptyBrain('owner', 'Warung Uji'))).toBe('missing')
  })

  it('a description and one product is sparse', () => {
    expect(assessBrainRichness(sparseBrain())).toBe('sparse')
  })

  it('identity, location, products and a confirmed section is grounded', () => {
    expect(assessBrainRichness(groundedBrain())).toBe('grounded')
  })
})

describe('clampConfidence', () => {
  it('a sparse brain caps high at medium', () => {
    expect(clampConfidence('high', 'sparse')).toBe('medium')
  })

  it('a missing brain caps everything at low', () => {
    expect(clampConfidence('high', 'missing')).toBe('low')
    expect(clampConfidence('medium', 'missing')).toBe('low')
  })

  it('a grounded brain leaves the claim alone', () => {
    expect(clampConfidence('high', 'grounded')).toBe('high')
  })

  it('never raises a cautious claim', () => {
    expect(clampConfidence('low', 'grounded')).toBe('low')
    expect(clampConfidence('low', 'sparse')).toBe('low')
  })
})
