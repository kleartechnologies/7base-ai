/**
 * Primitives shared by every MARKA entity.
 *
 * Timestamps are modelled as epoch milliseconds rather than Firestore
 * `Timestamp` objects so these types stay usable in the Cloud Functions
 * codebase, in tests, and over the wire without an SDK dependency.
 */
export type Millis = number

export type EntityId = string

/** Every stored document carries these. */
export interface BaseEntity {
  id: EntityId
  createdAt: Millis
  updatedAt: Millis
}

/**
 * Documents a single user owns. Firestore rules are written against
 * `ownerId`, so it must be present on every user-scoped document.
 */
export interface OwnedEntity extends BaseEntity {
  ownerId: EntityId
}

/**
 * Where a piece of MARKA-held knowledge came from.
 *
 * Only `user`, `website` and `inferred` are produced today. The rest are
 * declared now so the Business Brain is never shaped around website-only data
 * — adding Instagram later must be a new producer, not a schema migration.
 */
export type SourceKind =
  | 'user'
  | 'website'
  | 'document'
  | 'facebook'
  | 'instagram'
  | 'google_business'
  | 'pos'
  | 'meta_ads'
  | 'inferred'

/**
 * Wraps a value MARKA discovered rather than one the user typed, so the
 * Business tab can show provenance and let the user confirm or correct it.
 */
export interface Discovered<T> {
  value: T
  source: SourceKind
  /**
   * The specific place the value came from — usually the page URL that
   * supported it. Null when the source has no addressable location (a user
   * edit, or an inference drawn across several pages).
   */
  sourceRef: string | null
  /** 0–1. How strongly the source supports this value. */
  confidence: number
  /**
   * True once the owner has explicitly accepted or edited the value.
   *
   * Deliberately independent of `source`. An owner who reads what MARKA found
   * on their website and says "yes, that's right" has not authored the value —
   * they have vouched for it. Recording that as `source: 'user'` would erase
   * where it actually came from; recording it as `confirmed` keeps the origin
   * and still puts the claim above every discovered source (see
   * `authorityOf`), so a later re-analysis cannot quietly overwrite it.
   */
  confirmed: boolean
  discoveredAt: Millis
  /**
   * When the owner accepted or edited it. Absent on values MARKA discovered
   * and on documents written before acceptance was recorded.
   */
  confirmedAt?: Millis | null
}

export type AsyncStatus = 'idle' | 'loading' | 'ready' | 'error'
