import { describe, expect, it } from 'vitest'

import { SOURCE_AUTHORITY, authorityOf, claimOf, outranks } from './authority'
import type { AuthorityClaim } from './authority'

/**
 * These tests are the written form of the promise in §20/§21: correcting MARKA
 * has to mean something. Every case below is really asking the same question —
 * can a later, weaker claim quietly undo the owner?
 */

const claim = (over: Partial<AuthorityClaim>): AuthorityClaim => ({
  source: 'website',
  confirmed: false,
  confidence: 0.6,
  ...over,
})

describe('SOURCE_AUTHORITY', () => {
  it('ranks the owner above every machine source', () => {
    const others = Object.entries(SOURCE_AUTHORITY).filter(([kind]) => kind !== 'user')
    for (const [, rank] of others) {
      expect(SOURCE_AUTHORITY.user).toBeGreaterThan(rank)
    }
  })

  it('ranks inference below every stated source', () => {
    const stated = Object.entries(SOURCE_AUTHORITY).filter(([kind]) => kind !== 'inferred')
    for (const [, rank] of stated) {
      expect(SOURCE_AUTHORITY.inferred).toBeLessThan(rank)
    }
  })

  it('puts maintained systems of record above public marketing copy', () => {
    expect(SOURCE_AUTHORITY.pos).toBeGreaterThan(SOURCE_AUTHORITY.website)
    expect(SOURCE_AUTHORITY.google_business).toBeGreaterThan(SOURCE_AUTHORITY.website)
    expect(SOURCE_AUTHORITY.facebook).toBeGreaterThan(SOURCE_AUTHORITY.website)
  })
})

describe('authorityOf', () => {
  it('lifts any confirmed value above every unconfirmed source', () => {
    const confirmedInference = authorityOf('inferred', true)
    for (const kind of Object.keys(SOURCE_AUTHORITY) as (keyof typeof SOURCE_AUTHORITY)[]) {
      expect(confirmedInference).toBeGreaterThan(authorityOf(kind, false))
    }
  })
})

describe('outranks', () => {
  it('accepts anything when nothing is stored yet', () => {
    expect(outranks(claim({ source: 'inferred', confidence: 0.2 }), null)).toBe(true)
  })

  it('refuses to overwrite a value the owner confirmed', () => {
    const confirmed = claim({ source: 'user', confirmed: true, confidence: 1 })
    expect(outranks(claim({ source: 'website', confidence: 0.99 }), confirmed)).toBe(false)
    expect(outranks(claim({ source: 'pos', confidence: 1 }), confirmed)).toBe(false)
  })

  it('refuses even when the confirmed value started life as a guess', () => {
    // A guess the owner ticked "looks good" on is now the owner's answer.
    const confirmedGuess = claim({ source: 'inferred', confirmed: true, confidence: 0.3 })
    expect(outranks(claim({ source: 'website', confidence: 1 }), confirmedGuess)).toBe(false)
  })

  it('lets another human edit displace an earlier confirmation', () => {
    const confirmed = claim({ source: 'user', confirmed: true, confidence: 1 })
    expect(outranks(claim({ source: 'user', confirmed: true, confidence: 1 }), confirmed)).toBe(true)
  })

  it('never lets an inference displace something the website stated', () => {
    const stated = claim({ source: 'website', confidence: 0.5 })
    expect(outranks(claim({ source: 'inferred', confidence: 1 }), stated)).toBe(false)
  })

  it('lets a stated fact displace an earlier inference', () => {
    const inferred = claim({ source: 'inferred', confidence: 0.9 })
    expect(outranks(claim({ source: 'website', confidence: 0.3 }), inferred)).toBe(true)
  })

  it('refreshes a same-source field so a re-read wins over a stale read', () => {
    const previous = claim({ source: 'website', confidence: 0.7 })
    expect(outranks(claim({ source: 'website', confidence: 0.7 }), previous)).toBe(true)
  })

  it('keeps the more confident of two same-source claims', () => {
    const previous = claim({ source: 'website', confidence: 0.8 })
    expect(outranks(claim({ source: 'website', confidence: 0.4 }), previous)).toBe(false)
  })
})

describe('claimOf', () => {
  it('reads a claim out of a stored provenance record', () => {
    expect(
      claimOf({
        source: 'user',
        sourceRef: null,
        confidence: 1,
        confirmed: true,
        discoveredAt: 1,
      }),
    ).toEqual({ source: 'user', confirmed: true, confidence: 1 })
  })

  it('reads a claim out of a Discovered wrapper', () => {
    expect(
      claimOf({
        value: 'Friendly',
        source: 'inferred',
        sourceRef: 'https://example.com',
        confidence: 0.4,
        confirmed: false,
        discoveredAt: 1,
      }),
    ).toEqual({ source: 'inferred', confirmed: false, confidence: 0.4 })
  })

  it('reports "nothing stored" as null rather than a zero-authority claim', () => {
    expect(claimOf(null)).toBeNull()
  })
})
