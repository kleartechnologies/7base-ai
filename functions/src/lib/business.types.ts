/**
 * Business Brain wire types, mirrored from `src/types/business.ts`.
 *
 * Duplicated rather than imported for the same reason as `lib/types.ts`:
 * Functions builds as a separate CommonJS package with its own tsconfig and
 * `rootDir: src`, so it cannot reach into the web app's sources. If these two
 * files drift, onboarding writes documents the frontend cannot read — change
 * them together.
 */

export type Millis = number

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

export interface Discovered<T> {
  value: T
  source: SourceKind
  sourceRef: string | null
  confidence: number
  /**
   * True once the owner explicitly accepted or edited the value. Independent
   * of `source`: accepting what the website said keeps `source: 'website'` and
   * still outranks every later discovery. See `authorityOf`.
   */
  confirmed: boolean
  discoveredAt: Millis
  /** When the owner accepted it. Absent on values MARKA discovered. */
  confirmedAt?: Millis | null
}

export type FieldProvenance = Omit<Discovered<never>, 'value'>

/** Fact paths MARKA is allowed to record provenance for. */
export const PROVENANCE_FIELDS = [
  'name',
  'identity.legalName',
  'identity.tagline',
  'identity.description',
  'identity.category',
  'identity.subIndustry',
  'identity.businessType',
  'contact.email',
  'contact.phone',
  'contact.whatsapp',
  'contact.socialProfiles',
  'location.addressLine1',
  'location.city',
  'location.state',
  'location.postcode',
  'location.serviceArea',
  'location.openingHours',
] as const

export type ProvenanceField = (typeof PROVENANCE_FIELDS)[number]

export const BRAIN_VERSION = 2

export type BusinessIndustry = 'food_and_beverage' | 'other'

export interface BusinessIdentity {
  legalName: string | null
  tagline: string | null
  description: string | null
  category: string | null
  subIndustry: string | null
  businessType: string | null
  foundedYear: number | null
}

export interface SocialProfile {
  platform: 'facebook' | 'instagram' | 'tiktok' | 'google' | 'other'
  handle: string
  url: string
}

export interface BusinessContact {
  email: string | null
  phone: string | null
  whatsapp: string | null
  website: string | null
  socialProfiles: SocialProfile[]
}

export interface BusinessLocation {
  addressLine1: string | null
  addressLine2: string | null
  city: string | null
  state: string | null
  postcode: string | null
  countryCode: string
  openingHours: string | null
  serviceArea: string | null
}

export interface Product {
  id: string
  name: string
  description: string | null
  priceMinor: number | null
  currency: string
  category: string | null
  imageUrl: string | null
  isSignature: boolean
  attributes: string[]
  source: SourceKind
  sourceRef: string | null
  confidence: number
  confirmed: boolean
  /** When the owner accepted it. Absent on values MARKA discovered. */
  confirmedAt?: Millis | null
}

export interface AudienceSegment {
  id: string
  label: string
  description: string | null
  traits: string[]
}

export interface Audience {
  summary: string | null
  segments: AudienceSegment[]
  customerTypes: string[]
  demographics: string[]
  useCases: string[]
  needs: string[]
  preferences: string[]
}

export interface BrandColor {
  label: string
  hex: string
}

export interface BrandProfile {
  voice: string | null
  personalityTraits: string[]
  colors: BrandColor[]
  logoUrl: string | null
  fontFamily: string | null
  visualStyle: string | null
  keyMessages: string[]
  valuePropositions: string[]
}

export interface MarketingProfile {
  positioning: string | null
  valueProposition: string | null
  differentiators: string[]
  competitors: string[]
  activeChannels: string[]
  pastActivity: string | null
  promotions: string[]
  callsToAction: string[]
  themes: string[]
  emphasizedProducts: string[]
}

export interface OperationsProfile {
  openingHours: string | null
  orderingMethods: string[]
  deliveryPlatforms: string[]
  reservations: string | null
  notes: string[]
}

export interface ConnectedSource {
  id: string
  kind: SourceKind
  label: string
  reference: string
  status: 'pending' | 'connected' | 'failed' | 'disconnected'
  lastSyncedAt: Millis | null
}

export type DiscoveryStage =
  | 'fetching'
  | 'reading_pages'
  | 'understanding'
  | 'building_brain'
  | 'saving'

export type DiscoveryErrorCode =
  | 'invalid_url'
  | 'unreachable'
  /**
   * A social page that is not publicly visible to a server — a login wall,
   * a private account, an unavailable page. Retrying cannot fix it; telling
   * EVA about the business directly can.
   */
  | 'not_public'
  | 'insufficient_content'
  /** The AI service is momentarily overloaded. Trying again is worth it. */
  | 'ai_busy'
  /**
   * The AI service will not answer until someone changes the account — an
   * exhausted quota, a billing limit, a revoked key. Retrying cannot fix it,
   * so the UI must not invite the owner to sit and retry.
   */
  | 'ai_unavailable'
  /** The model answered, but not usably. */
  | 'ai_failed'
  | 'internal'

export interface DiscoveryState {
  status: 'not_started' | 'running' | 'complete' | 'failed'
  stage: DiscoveryStage | null
  lastRunAt: Millis | null
  /**
   * When the last analysis ATTEMPT began — written before the crawl, kept on
   * success and failure alike. The re-analysis cooldown keys on this so a
   * failed run cannot be retried in a tight loop. Optional: documents from
   * before Phase 6B do not carry it.
   */
  lastAttemptAt?: Millis | null
  completedAt: Millis | null
  sourceRef: string | null
  pagesAnalysed: number
  error: string | null
  errorCode: DiscoveryErrorCode | null
  /** MARKA's own words about what it understood. Shown on the review screen. */
  summary: string | null
  /** What the website did not answer. Stated plainly rather than guessed at. */
  unknowns: string[]
}

/** The stored shape. Firestore keeps the id in the path, not the body. */
export interface StoredBusiness {
  ownerId: string
  name: string
  industry: BusinessIndustry
  identity: BusinessIdentity
  contact: BusinessContact
  location: BusinessLocation
  products: Product[]
  audience: Discovered<Audience> | null
  brand: Discovered<BrandProfile> | null
  marketing: Discovered<MarketingProfile> | null
  operations: Discovered<OperationsProfile> | null
  provenance: Record<string, FieldProvenance>
  sources: ConnectedSource[]
  discovery: DiscoveryState
  brainVersion: number
  createdAt: Millis
  updatedAt: Millis
}

/** --- Callable contracts ------------------------------------------------ */

export interface StartWebsiteAnalysisRequest {
  websiteUrl: string
  /** Re-analyse a specific business rather than matching on URL. */
  businessId?: string | null
}

export interface StartWebsiteAnalysisResponse {
  businessId: string
  /** The URL MARKA will actually fetch, after normalisation. */
  websiteUrl: string
  /** True when this business already held a completed analysis. */
  reanalysis: boolean
}

export interface RunWebsiteAnalysisRequest {
  businessId: string
}

export interface RunWebsiteAnalysisResponse {
  businessId: string
  pagesAnalysed: number
  productsFound: number
}
