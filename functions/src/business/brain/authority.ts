import type { Discovered, FieldProvenance, SourceKind } from '../../lib/business.types'

/**
 * The data authority model.
 *
 * MARKA will eventually learn about a business from several places at once —
 * its website, its Instagram, its Google Business Profile, its POS — and those
 * sources will disagree. This module is the single rule for who wins.
 *
 * The rule that matters most in practice: if the owner told MARKA something,
 * MARKA does not quietly change its mind later. A re-analysis that overwrote a
 * correction would teach owners that correcting MARKA is pointless.
 */

/** Higher wins. Gaps are deliberate, so sources can be slotted in between. */
export const SOURCE_AUTHORITY: Record<SourceKind, number> = {
  /** The owner said so. Only another human edit displaces this. */
  user: 100,
  /** Systems of record the business actively maintains. */
  pos: 70,
  google_business: 62,
  facebook: 60,
  instagram: 60,
  meta_ads: 58,
  document: 55,
  /** Public marketing copy: usually true, sometimes years out of date. */
  website: 40,
  /** MARKA's own reading between the lines. Always the weakest claim. */
  inferred: 10,
}

/**
 * A confirmed value is authoritative regardless of where it originally came
 * from.
 *
 * This is what makes owner *acceptance* work without falsifying provenance.
 * When an owner reviews the Business Brain and says "looks good", MARKA does
 * not restamp the values as though the owner had typed them — they keep
 * `source: 'website'` or `'inferred'` and gain `confirmed`. The value still
 * says honestly where it came from; this constant is what stops the next
 * website read from overwriting it anyway.
 */
const CONFIRMED_AUTHORITY = 1_000

export function authorityOf(source: SourceKind, confirmed: boolean): number {
  if (confirmed) return CONFIRMED_AUTHORITY
  return SOURCE_AUTHORITY[source] ?? 0
}

export interface AuthorityClaim {
  source: SourceKind
  confirmed: boolean
  confidence: number
}

/**
 * True when `incoming` may replace `existing`.
 *
 * Ties go to the newer value: two website reads of the same field should end
 * with the current one, not the first one ever taken.
 */
export function outranks(incoming: AuthorityClaim, existing: AuthorityClaim | null): boolean {
  if (!existing) return true

  const incomingRank = authorityOf(incoming.source, incoming.confirmed)
  const existingRank = authorityOf(existing.source, existing.confirmed)

  if (incomingRank !== existingRank) return incomingRank > existingRank
  return incoming.confidence >= existing.confidence
}

export function claimOf(value: Discovered<unknown> | FieldProvenance | null): AuthorityClaim | null {
  if (!value) return null
  return { source: value.source, confirmed: value.confirmed, confidence: value.confidence }
}
