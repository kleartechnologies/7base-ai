import { PROVENANCE_FIELDS, type ProvenanceField } from '../../lib/business.types'

/**
 * Validation of the model's structured output.
 *
 * A JSON schema constrains generation; it does not guarantee it. This module
 * treats the model's response as untrusted input — the same posture as the
 * user-supplied URL — and either produces a value the rest of MARKA can rely
 * on or refuses. Nothing malformed is ever written to Firestore.
 *
 * It also coerces rather than rejecting on every imperfection: a confidence of
 * 1.4 is clamped, a 300-item product list is truncated, an empty product name
 * is dropped. Failing the whole analysis because one menu row was odd would
 * serve the user badly.
 */

const LIMITS = {
  shortText: 120,
  mediumText: 400,
  longText: 1_200,
  listItems: 15,
  listItemText: 120,
  products: 60,
  segments: 6,
  socialProfiles: 8,
  unknowns: 10,
} as const

export interface AnalysedProduct {
  name: string
  description: string | null
  price: number | null
  currency: string | null
  category: string | null
  attributes: string[]
  isSignature: boolean
  sourceUrl: string | null
  confidence: number
}

export interface AnalysedSocialProfile {
  platform: 'facebook' | 'instagram' | 'tiktok' | 'google' | 'other'
  handle: string | null
  url: string
}

export interface AnalysedSection {
  sourceUrl: string | null
  confidence: number
}

export interface WebsiteAnalysis {
  identity: {
    businessName: string | null
    legalName: string | null
    tagline: string | null
    description: string | null
    category: string | null
    subIndustry: string | null
    businessType: string | null
    industry: 'food_and_beverage' | 'other'
  }
  location: {
    addressLine1: string | null
    city: string | null
    state: string | null
    postcode: string | null
    countryCode: string | null
    serviceArea: string | null
    openingHours: string | null
  }
  contact: {
    email: string | null
    phone: string | null
    whatsapp: string | null
    socialProfiles: AnalysedSocialProfile[]
  }
  products: AnalysedProduct[]
  audience: AnalysedSection & {
    summary: string | null
    customerTypes: string[]
    demographics: string[]
    useCases: string[]
    needs: string[]
    preferences: string[]
    segments: { label: string; description: string | null; traits: string[] }[]
  }
  brand: AnalysedSection & {
    voice: string | null
    personalityTraits: string[]
    visualStyle: string | null
    keyMessages: string[]
    valuePropositions: string[]
  }
  marketing: AnalysedSection & {
    positioning: string | null
    valueProposition: string | null
    differentiators: string[]
    activeChannels: string[]
    promotions: string[]
    callsToAction: string[]
    themes: string[]
    emphasizedProducts: string[]
  }
  operations: AnalysedSection & {
    openingHours: string | null
    orderingMethods: string[]
    deliveryPlatforms: string[]
    reservations: string | null
    notes: string[]
  }
  fieldSources: { field: ProvenanceField; sourceUrl: string | null; confidence: number }[]
  unknowns: string[]
  summary: string
}

export class AnalysisValidationError extends Error {
  constructor(reason: string) {
    super(`Model output failed validation: ${reason}`)
    this.name = 'AnalysisValidationError'
  }
}

export class InsufficientContentError extends Error {
  constructor() {
    super('The website did not contain enough information to describe a business.')
    this.name = 'InsufficientContentError'
  }
}

export function validateWebsiteAnalysis(raw: unknown): WebsiteAnalysis {
  if (!isRecord(raw)) throw new AnalysisValidationError('response was not an object')

  const identity = record(raw.identity)
  const location = record(raw.location)
  const contact = record(raw.contact)
  const audience = record(raw.audience)
  const brand = record(raw.brand)
  const marketing = record(raw.marketing)
  const operations = record(raw.operations)

  return {
    identity: {
      businessName: text(identity.businessName, LIMITS.shortText),
      legalName: text(identity.legalName, LIMITS.shortText),
      tagline: text(identity.tagline, LIMITS.mediumText),
      description: text(identity.description, LIMITS.longText),
      category: text(identity.category, LIMITS.shortText),
      subIndustry: text(identity.subIndustry, LIMITS.shortText),
      businessType: text(identity.businessType, LIMITS.shortText),
      industry: identity.industry === 'other' ? 'other' : 'food_and_beverage',
    },
    location: {
      addressLine1: text(location.addressLine1, LIMITS.mediumText),
      city: text(location.city, LIMITS.shortText),
      state: text(location.state, LIMITS.shortText),
      postcode: text(location.postcode, 16),
      countryCode: countryCode(location.countryCode),
      serviceArea: text(location.serviceArea, LIMITS.mediumText),
      openingHours: text(location.openingHours, LIMITS.mediumText),
    },
    contact: {
      email: email(contact.email),
      phone: phone(contact.phone),
      whatsapp: phone(contact.whatsapp),
      socialProfiles: socialProfiles(contact.socialProfiles),
    },
    products: products(raw.products),
    audience: {
      summary: text(audience.summary, LIMITS.mediumText),
      customerTypes: list(audience.customerTypes),
      demographics: list(audience.demographics),
      useCases: list(audience.useCases),
      needs: list(audience.needs),
      preferences: list(audience.preferences),
      segments: segments(audience.segments),
      sourceUrl: url(audience.sourceUrl),
      confidence: confidence(audience.confidence),
    },
    brand: {
      voice: text(brand.voice, LIMITS.mediumText),
      personalityTraits: list(brand.personalityTraits),
      visualStyle: text(brand.visualStyle, LIMITS.mediumText),
      keyMessages: list(brand.keyMessages, LIMITS.mediumText),
      valuePropositions: list(brand.valuePropositions, LIMITS.mediumText),
      sourceUrl: url(brand.sourceUrl),
      confidence: confidence(brand.confidence),
    },
    marketing: {
      positioning: text(marketing.positioning, LIMITS.mediumText),
      valueProposition: text(marketing.valueProposition, LIMITS.mediumText),
      differentiators: list(marketing.differentiators, LIMITS.mediumText),
      activeChannels: list(marketing.activeChannels),
      promotions: list(marketing.promotions, LIMITS.mediumText),
      callsToAction: list(marketing.callsToAction),
      themes: list(marketing.themes),
      emphasizedProducts: list(marketing.emphasizedProducts),
      sourceUrl: url(marketing.sourceUrl),
      confidence: confidence(marketing.confidence),
    },
    operations: {
      openingHours: text(operations.openingHours, LIMITS.mediumText),
      orderingMethods: list(operations.orderingMethods),
      deliveryPlatforms: list(operations.deliveryPlatforms),
      reservations: text(operations.reservations, LIMITS.mediumText),
      notes: list(operations.notes, LIMITS.mediumText),
      sourceUrl: url(operations.sourceUrl),
      confidence: confidence(operations.confidence),
    },
    fieldSources: fieldSources(raw.fieldSources),
    unknowns: list(raw.unknowns, LIMITS.mediumText).slice(0, LIMITS.unknowns),
    summary: text(raw.summary, LIMITS.longText) ?? '',
  }
}

/**
 * Refuses an analysis that says nothing.
 *
 * A parked domain or a one-page splash screen will still produce a
 * well-formed object full of nulls. Storing that would leave the owner with an
 * empty Business Brain and no explanation, so it is treated as a failure with
 * its own message and its own recovery path.
 */
export function assertAnalysisUseful(analysis: WebsiteAnalysis): void {
  const hasName = Boolean(analysis.identity.businessName)
  const hasSubstance =
    Boolean(analysis.identity.description) ||
    analysis.products.length > 0 ||
    Boolean(analysis.identity.category)

  if (!hasName || !hasSubstance) throw new InsufficientContentError()
}

/* --- coercion helpers -------------------------------------------------- */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function record(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}

export function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const clean = value.replace(/\s+/g, ' ').trim()
  if (!clean) return null
  // Models occasionally answer the prompt instead of the field.
  if (/^(unknown|n\/?a|none|not (found|stated|available|specified))$/i.test(clean)) return null
  return clean.length > max ? `${clean.slice(0, max).trimEnd()}…` : clean
}

export function list(value: unknown, max: number = LIMITS.listItemText): string[] {
  if (!Array.isArray(value)) return []
  const items: string[] = []
  const seen = new Set<string>()

  for (const entry of value) {
    const clean = text(entry, max)
    if (!clean) continue
    const key = clean.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    items.push(clean)
    if (items.length >= LIMITS.listItems) break
  }

  return items
}

/**
 * Confidence is clamped, never invented.
 *
 * A missing or non-numeric confidence becomes 0.5 — "MARKA is unsure" — rather
 * than 1, so a model that omits the field cannot accidentally assert a fact.
 */
export function confidence(value: unknown): number {
  // `Number(null)` and `Number('')` are 0, which would read as "certainly
  // false" rather than "not answered". Absent means unsure.
  if (value === null || value === undefined || value === '') return 0.5
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return 0.5
  const clamped = Math.min(1, Math.max(0, numeric))
  return Math.round(clamped * 100) / 100
}

function url(value: unknown): string | null {
  if (typeof value !== 'string') return null
  try {
    const parsed = new URL(value.trim())
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    return parsed.toString()
  } catch {
    return null
  }
}

function email(value: unknown): string | null {
  const clean = text(value, LIMITS.shortText)
  if (!clean) return null
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(clean) ? clean.toLowerCase() : null
}

function phone(value: unknown): string | null {
  const clean = text(value, 40)
  if (!clean) return null
  const digits = clean.replace(/[^\d+]/g, '')
  return digits.replace(/\D/g, '').length >= 7 ? digits : null
}

function countryCode(value: unknown): string | null {
  const clean = text(value, 8)
  if (!clean) return null
  return /^[A-Za-z]{2}$/.test(clean) ? clean.toUpperCase() : null
}

function socialProfiles(value: unknown): AnalysedSocialProfile[] {
  if (!Array.isArray(value)) return []
  const profiles: AnalysedSocialProfile[] = []
  const seen = new Set<string>()

  for (const entry of value) {
    if (!isRecord(entry)) continue
    const href = url(entry.url)
    if (!href || seen.has(href)) continue
    seen.add(href)

    const platform = entry.platform
    profiles.push({
      platform:
        platform === 'facebook' ||
        platform === 'instagram' ||
        platform === 'tiktok' ||
        platform === 'google'
          ? platform
          : 'other',
      handle: text(entry.handle, 60),
      url: href,
    })
    if (profiles.length >= LIMITS.socialProfiles) break
  }

  return profiles
}

function products(value: unknown): AnalysedProduct[] {
  if (!Array.isArray(value)) return []
  const items: AnalysedProduct[] = []
  const seen = new Set<string>()

  for (const entry of value) {
    if (!isRecord(entry)) continue
    const name = text(entry.name, LIMITS.shortText)
    if (!name) continue

    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)

    const price = typeof entry.price === 'number' && Number.isFinite(entry.price) && entry.price >= 0
      ? Math.round(entry.price * 100) / 100
      : null

    items.push({
      name,
      description: text(entry.description, LIMITS.mediumText),
      price,
      currency: countryAgnosticCurrency(entry.currency),
      category: text(entry.category, LIMITS.shortText),
      attributes: list(entry.attributes),
      isSignature: entry.isSignature === true,
      sourceUrl: url(entry.sourceUrl),
      confidence: confidence(entry.confidence),
    })

    if (items.length >= LIMITS.products) break
  }

  return items
}

function countryAgnosticCurrency(value: unknown): string | null {
  const clean = text(value, 12)
  if (!clean) return null
  const upper = clean.toUpperCase()
  // Malaysian sites write the currency half a dozen ways; they all mean MYR.
  if (upper === 'RM' || upper === 'RINGGIT' || upper === 'RINGGIT MALAYSIA') return 'MYR'
  return /^[A-Z]{3}$/.test(upper) ? upper : null
}

function segments(value: unknown): WebsiteAnalysis['audience']['segments'] {
  if (!Array.isArray(value)) return []
  const items: WebsiteAnalysis['audience']['segments'] = []

  for (const entry of value) {
    if (!isRecord(entry)) continue
    const label = text(entry.label, LIMITS.shortText)
    if (!label) continue
    items.push({
      label,
      description: text(entry.description, LIMITS.mediumText),
      traits: list(entry.traits),
    })
    if (items.length >= LIMITS.segments) break
  }

  return items
}

function fieldSources(value: unknown): WebsiteAnalysis['fieldSources'] {
  if (!Array.isArray(value)) return []
  const allowed = new Set<string>(PROVENANCE_FIELDS)
  const items: WebsiteAnalysis['fieldSources'] = []
  const seen = new Set<string>()

  for (const entry of value) {
    if (!isRecord(entry)) continue
    const field = typeof entry.field === 'string' ? entry.field : ''
    if (!allowed.has(field) || seen.has(field)) continue
    seen.add(field)
    items.push({
      field: field as ProvenanceField,
      sourceUrl: url(entry.sourceUrl),
      confidence: confidence(entry.confidence),
    })
  }

  return items
}
