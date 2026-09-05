import {
  BRAIN_VERSION,
  PROVENANCE_FIELDS,
  type Business,
  type BusinessDraft,
  type Discovered,
  type FieldProvenance,
  type Millis,
  type Product,
  type ProvenanceField,
  type SourceKind,
} from '@/types'
import { t } from '@/i18n/store'

/**
 * Business Brain shaping, kept free of Firebase so it can be reasoned about
 * and tested on its own.
 *
 * One rule runs through this file: **an edit by the owner is the highest
 * authority in the Brain.** Anything the owner types is stamped
 * `source: 'user', confidence: 1, confirmed: true`, which is what stops the
 * next website analysis from quietly undoing their correction.
 */

/** The plain, directly-edited half of the Brain. */
export type BusinessFacts = Pick<Business, 'name' | 'identity' | 'contact' | 'location'>

/** Brain sections that carry their own provenance wrapper. */
export type BrainSectionKey = 'audience' | 'brand' | 'marketing' | 'operations'

/** Provenance for a value the owner supplied. Nothing outranks this. */
export function userProvenance(now: Millis = Date.now()): FieldProvenance {
  return {
    source: 'user',
    sourceRef: null,
    confidence: 1,
    confirmed: true,
    discoveredAt: now,
    confirmedAt: now,
  }
}

/** Wraps a section the owner wrote or corrected. */
export function userDiscovered<T>(value: T, now: Millis = Date.now()): Discovered<T> {
  return {
    value,
    source: 'user',
    sourceRef: null,
    confidence: 1,
    confirmed: true,
    discoveredAt: now,
    confirmedAt: now,
  }
}

/**
 * Marks an existing claim as accepted by the owner, without rewriting where it
 * came from.
 *
 * This is the difference between *editing* and *accepting*. An edit replaces
 * the value, so the owner is its author and `source: 'user'` is the truth. An
 * acceptance leaves the value exactly as MARKA found it — the owner has read
 * "we're a halal Malay restaurant in Banting, read from your website" and
 * agreed. Restamping that as `source: 'user'` would be a small lie that
 * compounds: MARKA would later be unable to tell the owner where the fact came
 * from, and could not explain itself when the website changed.
 *
 * `confirmed` is what carries the authority (see the backend `authorityOf`),
 * so an accepted website fact already outranks any future website reading
 * while keeping its origin intact.
 */
export function acceptClaim<T extends { confirmed: boolean; confirmedAt?: Millis | null }>(
  claim: T,
  now: Millis = Date.now(),
): T {
  if (claim.confirmed) return claim
  return { ...claim, confirmed: true, confirmedAt: now }
}

/**
 * A brand-new business with nothing known about it yet.
 *
 * `sources` and `discovery` are left pristine on purpose: security rules
 * reject a client-created business that claims to have already been analysed.
 */
export function emptyBusiness(
  ownerId: string,
  draft: BusinessDraft,
  now: Millis = Date.now(),
): Omit<Business, 'id'> {
  const name = draft.name.trim()
  const offering = draft.offering?.trim() || null
  const website = draft.websiteUrl?.trim() || null

  const business: Omit<Business, 'id'> = {
    ownerId,
    name,
    industry: draft.industry ?? 'food_and_beverage',
    identity: {
      legalName: null,
      tagline: null,
      description: offering,
      category: null,
      subIndustry: null,
      businessType: null,
      foundedYear: null,
    },
    contact: {
      email: null,
      phone: null,
      whatsapp: null,
      website,
      socialProfiles: [],
    },
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
    brainVersion: BRAIN_VERSION,
    createdAt: now,
    updatedAt: now,
  }

  // Whatever the owner typed is theirs, and outranks anything discovered later.
  business.provenance.name = userProvenance(now)
  if (offering) business.provenance['identity.description'] = userProvenance(now)

  return business
}

/** Reads a dotted fact path out of the editable half of the Brain. */
export function readFact(facts: BusinessFacts, path: ProvenanceField): unknown {
  const segments = path.split('.')
  let current: unknown = facts
  for (const segment of segments) {
    if (current === null || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}

/**
 * Stamps every fact the owner actually changed as user-confirmed.
 *
 * Untouched fields keep whatever provenance they already had — accepting a
 * review screen wholesale is not the same as vouching for each field, and
 * pretending otherwise would freeze the Brain against ever being refreshed.
 */
export function provenanceForEdits(
  existing: Business,
  next: BusinessFacts,
  now: Millis = Date.now(),
): Record<string, FieldProvenance> {
  const provenance = { ...existing.provenance }

  for (const path of PROVENANCE_FIELDS) {
    const before = readFact(existing, path)
    const after = readFact(next, path)
    if (!sameValue(before, after)) {
      provenance[path] = userProvenance(now)
    }
  }

  return provenance
}

/** The write "Looks good" performs. Nothing else about the Brain changes. */
export interface BrainAcceptance {
  provenance: Record<string, FieldProvenance>
  products: Product[]
  audience: Business['audience']
  brand: Business['brand']
  marketing: Business['marketing']
  operations: Business['operations']
}

/**
 * Turns "the owner read this and said it was right" into stored authority.
 *
 * Before this existed, clicking "Looks good — continue" only advanced
 * onboarding: everything MARKA had discovered stayed unconfirmed, and the next
 * website analysis was free to overwrite all of it. The owner's review meant
 * nothing.
 *
 * Two rules shape what gets stamped:
 *
 *  1. **Only what is actually on screen.** A field MARKA left null was not
 *     reviewed — there was nothing to review. Confirming it would freeze it as
 *     an accepted blank and stop the next analysis from ever filling it in.
 *     Unknowns stay unstamped, and stay refreshable.
 *
 *  2. **Origin is preserved.** Accepted values keep `source: 'website'` or
 *     `'inferred'` and gain `confirmed`. See `acceptClaim`.
 */
export function acceptBrain(business: Business, now: Millis = Date.now()): BrainAcceptance {
  const provenance: Record<string, FieldProvenance> = { ...business.provenance }

  for (const path of PROVENANCE_FIELDS) {
    if (isEmptyFact(readFact(business, path))) continue

    const existing = provenance[path]
    provenance[path] = existing
      ? acceptClaim(existing, now)
      : // A value with no provenance can only have got there by the owner
        // typing it (manual onboarding), so recording them as its source is
        // accurate rather than a guess.
        userProvenance(now)
  }

  return {
    provenance,
    products: business.products.map((product) => acceptClaim(product, now)),
    audience: business.audience ? acceptClaim(business.audience, now) : null,
    brand: business.brand ? acceptClaim(business.brand, now) : null,
    marketing: business.marketing ? acceptClaim(business.marketing, now) : null,
    operations: business.operations ? acceptClaim(business.operations, now) : null,
  }
}

/** "MARKA did not find this", for every shape a fact can take. */
function isEmptyFact(value: unknown): boolean {
  if (value === null || value === undefined) return true
  if (typeof value === 'string') return value.trim().length === 0
  if (Array.isArray(value)) return value.length === 0
  return false
}

/** Structural comparison, deep enough for the shapes provenance covers. */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a == null || b == null) return (a ?? null) === (b ?? null)
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => sameValue(item, b[index]))
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const left = a as Record<string, unknown>
    const right = b as Record<string, unknown>
    const keys = new Set([...Object.keys(left), ...Object.keys(right)])
    for (const key of keys) {
      if (!sameValue(left[key], right[key])) return false
    }
    return true
  }
  return false
}

/**
 * True when the Brain holds enough to be worth reviewing.
 *
 * Used to decide whether onboarding can move on, and whether the Business tab
 * should show its empty state.
 */
export function hasUsefulKnowledge(business: Business | null): boolean {
  if (!business) return false
  return Boolean(
    business.identity.description ||
      business.identity.category ||
      business.products.length > 0 ||
      business.audience ||
      business.brand,
  )
}

/**
 * Where a value came from, in words the owner will recognise.
 *
 * The single source of truth for provenance wording — the Business Brain UI
 * renders these strings verbatim, so an owner can tell a fact read off their
 * own website from something MARKA worked out, without opening anything.
 *
 * Confirmation is checked first because it is the more useful thing to say:
 * once the owner has stood behind a value, where it originally came from stops
 * changing what they can do about it.
 */
/**
 * The least a value has to carry to say where it came from.
 *
 * Structural on purpose: `Discovered<T>`, a `FieldProvenance` stamp and a
 * `Product` all satisfy it, so one wording lives here rather than three
 * near-copies drifting apart in the UI.
 */
export interface SourceMark {
  source: SourceKind
  confirmed: boolean
}

export function describeSource(source: SourceMark | null | undefined): string | null {
  if (!source) return null
  // Resolved through the i18n store at render time, so the wording follows the
  // active UI language without this module depending on React.
  if (source.confirmed || source.source === 'user') return t('brain.confirmedByYou')
  switch (source.source) {
    case 'website':
      return t('brain.fromWebsite')
    case 'facebook':
      return t('brain.fromFacebook')
    case 'instagram':
      return t('brain.fromInstagram')
    case 'google_business':
      return t('brain.fromGoogleBusiness')
    case 'inferred':
      return t('brain.evaInference')
    case 'document':
      return t('brain.fromDocument')
    default:
      return t('brain.fromConnectedSource')
  }
}

/** Which of the three provenance shapes to draw. Paired with `describeSource`. */
export type SourceTone = 'confirmed' | 'sourced' | 'inferred'

export function sourceTone(source: SourceMark | null | undefined): SourceTone | null {
  if (!source) return null
  if (source.confirmed || source.source === 'user') return 'confirmed'
  return source.source === 'inferred' ? 'inferred' : 'sourced'
}
