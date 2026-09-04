import type { Discovered, Millis, OwnedEntity, SourceKind } from './common'

/**
 * Provenance for a plain fact — a value that is read off a page rather than
 * inferred, so it needs a source and a confirmation flag but not a wrapper.
 *
 * Keyed by dotted path (`identity.category`, `location.city`) in
 * `Business.provenance`. Keeping it beside the data rather than inside it
 * means `business.location.city` stays a string everywhere it is read, while
 * the Business tab can still show where the city came from and whether the
 * owner has confirmed it.
 */
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

/**
 * The Business Brain.
 *
 * Everything MARKA knows about a business. Most of it is meant to be
 * *discovered* (website, social profiles, uploaded menus) rather than typed
 * into a form, which is why the soft sections are wrapped in `Discovered<T>`:
 * the UI can then show what MARKA found and let the owner confirm it.
 *
 * Only `name` is genuinely required. Onboarding must stay low-friction.
 */
export interface Business extends OwnedEntity {
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
  /**
   * Where each plain fact came from, keyed by dotted path. Absent entries mean
   * MARKA has no provenance for that field — usually because it is still empty.
   */
  provenance: Record<string, FieldProvenance>
  /** External systems MARKA can read from. Written server-side only. */
  sources: ConnectedSource[]
  /** Bookkeeping for the discovery pipeline. Written server-side only. */
  discovery: DiscoveryState
  /**
   * Shape version of this document. Bumped when the Brain gains or moves a
   * field, so a reader can tell a stale document from a current one instead of
   * inferring it from which keys happen to be missing.
   */
  brainVersion: number
}

/** Current Business Brain shape version. */
export const BRAIN_VERSION = 2

/** V1 targets Malaysian F&B; the field exists so widening is not a migration. */
export type BusinessIndustry = 'food_and_beverage' | 'other'

export interface BusinessIdentity {
  legalName: string | null
  tagline: string | null
  description: string | null
  /**
   * Three overlapping-sounding but distinct axes, kept apart because campaign
   * generation will need them separately:
   *  - `category`     the short human label shown in the UI ("Middle Eastern restaurant")
   *  - `subIndustry`  the cuisine or niche ("Middle Eastern", "nasi lemak")
   *  - `businessType` the operating model ("restaurant", "cafe", "food truck", "catering")
   */
  category: string | null
  subIndustry: string | null
  businessType: string | null
  foundedYear: number | null
}

export interface BusinessContact {
  email: string | null
  phone: string | null
  whatsapp: string | null
  website: string | null
  socialProfiles: SocialProfile[]
}

export interface SocialProfile {
  platform: SocialPlatform
  handle: string
  url: string
}

export type SocialPlatform = 'facebook' | 'instagram' | 'tiktok' | 'google' | 'other'

export interface BusinessLocation {
  addressLine1: string | null
  addressLine2: string | null
  city: string | null
  state: string | null
  postcode: string | null
  countryCode: string
  /** Free-form for now; structured opening hours come with the calendar work. */
  openingHours: string | null
  /** Where the business will actually serve, e.g. "Klang Valley, delivery only". */
  serviceArea: string | null
}

export interface Product {
  id: string
  name: string
  description: string | null
  /** Minor units (sen) to avoid float drift. */
  priceMinor: number | null
  currency: string
  category: string | null
  imageUrl: string | null
  isSignature: boolean
  /** Short factual tags read off the page: "spicy", "halal", "set for 2". */
  attributes: string[]
  source: SourceKind
  /** The page this product was read from, when there was one. */
  sourceRef: string | null
  confidence: number
  confirmed: boolean
  /** When the owner accepted it. Absent on values MARKA discovered. */
  confirmedAt?: Millis | null
}

export interface Audience {
  summary: string | null
  segments: AudienceSegment[]
  /** "Families", "office workers" — who the site appears to be written for. */
  customerTypes: string[]
  demographics: string[]
  useCases: string[]
  needs: string[]
  preferences: string[]
}

export interface AudienceSegment {
  id: string
  label: string
  description: string | null
  /** Short, human phrases — not a targeting spec. */
  traits: string[]
}

export interface BrandProfile {
  /** How the business should sound. */
  voice: string | null
  personalityTraits: string[]
  colors: BrandColor[]
  logoUrl: string | null
  fontFamily: string | null
  /** How the business looks, in words: "warm, photo-led, minimal". */
  visualStyle: string | null
  /** Lines the site repeats often enough to count as messaging. */
  keyMessages: string[]
  valuePropositions: string[]
}

export interface BrandColor {
  label: string
  hex: string
}

export interface MarketingProfile {
  positioning: string | null
  valueProposition: string | null
  /** USPs. */
  differentiators: string[]
  competitors: string[]
  /** Channels the business already uses. */
  activeChannels: string[]
  /** What they have run before, in the owner's own words. */
  pastActivity: string | null
  /** Offers and promotions actually advertised on the site. */
  promotions: string[]
  /** "Order on WhatsApp", "Book a table" — what the site asks visitors to do. */
  callsToAction: string[]
  /** Recurring themes: "family gatherings", "authentic recipes". */
  themes: string[]
  /** Products the site itself pushes hardest. Not a sales claim. */
  emphasizedProducts: string[]
}

export interface OperationsProfile {
  openingHours: string | null
  /** "Dine-in", "takeaway", "WhatsApp order". */
  orderingMethods: string[]
  /** "GrabFood", "foodpanda", "own delivery". */
  deliveryPlatforms: string[]
  reservations: string | null
  notes: string[]
}

export interface ConnectedSource {
  id: string
  kind: SourceKind
  label: string
  /** Website URL, storage path, or external account id. */
  reference: string
  status: 'pending' | 'connected' | 'failed' | 'disconnected'
  lastSyncedAt: Millis | null
}

/**
 * The discovery pipeline's own state.
 *
 * `stage` is written as the backend actually reaches each step, so the
 * onboarding screen can report real progress instead of animating a fake one.
 */
export interface DiscoveryState {
  status: 'not_started' | 'running' | 'complete' | 'failed'
  stage: DiscoveryStage | null
  lastRunAt: Millis | null
  /** Set when analysis finished successfully. */
  completedAt: Millis | null
  /** What was analysed, e.g. the normalised website URL. */
  sourceRef: string | null
  pagesAnalysed: number
  /** Surfaced to the user when discovery fails; never a raw stack trace. */
  error: string | null
  /** Distinguishes "try again" from "this website will never work". */
  errorCode: DiscoveryErrorCode | null
  /** MARKA's own words about what it understood. Shown on the review screen. */
  summary: string | null
  /** What the website did not answer. Stated plainly rather than guessed at. */
  unknowns: string[]
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

/** The minimum needed to create a business. Everything else is discovered. */
export interface BusinessDraft {
  name: string
  websiteUrl?: string | null
  industry?: BusinessIndustry
  /** The manual-fallback answer to "what do you sell?". Optional by design. */
  offering?: string | null
}
