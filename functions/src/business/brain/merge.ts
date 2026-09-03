import type {
  Audience,
  BrandProfile,
  ConnectedSource,
  Discovered,
  FieldProvenance,
  MarketingProfile,
  OperationsProfile,
  Product,
  SocialProfile,
  SourceKind,
  StoredBusiness,
} from '../../lib/business.types'
import { BRAIN_VERSION, PROVENANCE_FIELDS, type ProvenanceField } from '../../lib/business.types'
import { claimOf, outranks } from './authority'
import type { WebsiteAnalysis } from './validate'

/**
 * Folds a fresh website analysis into the Business Brain that already exists.
 *
 * This is where §20 and §21 are actually enforced. Re-analysing a website must
 * never undo a correction the owner made, so every field is written through
 * `outranks()` rather than assigned. A second run on an untouched Brain
 * therefore refreshes everything; a second run after the owner fixed the brand
 * voice refreshes everything *except* the brand voice.
 *
 * Returns a patch rather than a whole document so the caller writes exactly
 * the fields that changed.
 */

/**
 * Which kind of claim each section represents.
 *
 * Audience and brand personality are MARKA reading between the lines, so they
 * are `inferred` and rank below anything a source states outright. Promotions,
 * calls to action and opening hours are printed on the page, so they are
 * `website`. The distinction is what stops an inference from later
 * outranking a fact.
 */
const SECTION_SOURCES = {
  audience: 'inferred',
  brand: 'inferred',
  marketing: 'website',
  operations: 'website',
} as const satisfies Record<string, SourceKind>

/** Applied when the model returns a fact without an explicit confidence. */
const DEFAULT_FACT_CONFIDENCE = 0.6

export interface MergeContext {
  /** The URL that was actually analysed. */
  websiteUrl: string
  pagesAnalysed: number
  now: number
}

export type BrainPatch = Partial<StoredBusiness>

export function mergeWebsiteAnalysis(
  existing: StoredBusiness,
  analysis: WebsiteAnalysis,
  context: MergeContext,
): BrainPatch {
  const { now } = context
  const sourceConfidence = new Map<ProvenanceField, { sourceUrl: string | null; confidence: number }>()
  for (const entry of analysis.fieldSources) {
    sourceConfidence.set(entry.field, { sourceUrl: entry.sourceUrl, confidence: entry.confidence })
  }

  const provenance: Record<string, FieldProvenance> = { ...existing.provenance }

  /** Writes a fact only if the incoming claim outranks what is already stored. */
  function fact<T>(field: ProvenanceField, incomingValue: T | null, currentValue: T | null): T | null {
    if (incomingValue === null || incomingValue === undefined) return currentValue

    const hint = sourceConfidence.get(field)
    const incoming = {
      source: 'website' as const,
      confirmed: false,
      confidence: hint?.confidence ?? DEFAULT_FACT_CONFIDENCE,
    }

    if (!outranks(incoming, claimOf(provenance[field] ?? null))) return currentValue

    provenance[field] = {
      source: 'website',
      sourceRef: hint?.sourceUrl ?? context.websiteUrl,
      confidence: incoming.confidence,
      confirmed: false,
      discoveredAt: now,
      confirmedAt: null,
    }
    return incomingValue
  }

  const name = fact('name', analysis.identity.businessName, existing.name) ?? existing.name

  const identity: StoredBusiness['identity'] = {
    legalName: fact('identity.legalName', analysis.identity.legalName, existing.identity.legalName),
    tagline: fact('identity.tagline', analysis.identity.tagline, existing.identity.tagline),
    description: fact(
      'identity.description',
      analysis.identity.description,
      existing.identity.description,
    ),
    category: fact('identity.category', analysis.identity.category, existing.identity.category),
    subIndustry: fact(
      'identity.subIndustry',
      analysis.identity.subIndustry,
      existing.identity.subIndustry,
    ),
    businessType: fact(
      'identity.businessType',
      analysis.identity.businessType,
      existing.identity.businessType,
    ),
    foundedYear: existing.identity.foundedYear,
  }

  const contact: StoredBusiness['contact'] = {
    email: fact('contact.email', analysis.contact.email, existing.contact.email),
    phone: fact('contact.phone', analysis.contact.phone, existing.contact.phone),
    whatsapp: fact('contact.whatsapp', analysis.contact.whatsapp, existing.contact.whatsapp),
    // The analysed URL is not a discovery — it is the thing that was analysed.
    website: context.websiteUrl,
    socialProfiles:
      fact<SocialProfile[]>(
        'contact.socialProfiles',
        analysis.contact.socialProfiles.length > 0
          ? analysis.contact.socialProfiles.map((profile) => ({
              platform: profile.platform,
              handle: profile.handle ?? '',
              url: profile.url,
            }))
          : null,
        existing.contact.socialProfiles,
      ) ?? [],
  }

  const location: StoredBusiness['location'] = {
    addressLine1: fact(
      'location.addressLine1',
      analysis.location.addressLine1,
      existing.location.addressLine1,
    ),
    addressLine2: existing.location.addressLine2,
    city: fact('location.city', analysis.location.city, existing.location.city),
    state: fact('location.state', analysis.location.state, existing.location.state),
    postcode: fact('location.postcode', analysis.location.postcode, existing.location.postcode),
    countryCode: analysis.location.countryCode ?? existing.location.countryCode,
    openingHours: fact(
      'location.openingHours',
      analysis.location.openingHours ?? analysis.operations.openingHours,
      existing.location.openingHours,
    ),
    serviceArea: fact(
      'location.serviceArea',
      analysis.location.serviceArea,
      existing.location.serviceArea,
    ),
  }

  const audience = mergeSection<Audience>(
    existing.audience,
    hasAudience(analysis)
      ? {
          summary: analysis.audience.summary,
          segments: analysis.audience.segments.map((segment, index) => ({
            id: `seg_${index + 1}`,
            label: segment.label,
            description: segment.description,
            traits: segment.traits,
          })),
          customerTypes: analysis.audience.customerTypes,
          demographics: analysis.audience.demographics,
          useCases: analysis.audience.useCases,
          needs: analysis.audience.needs,
          preferences: analysis.audience.preferences,
        }
      : null,
    SECTION_SOURCES.audience,
    analysis.audience.sourceUrl ?? context.websiteUrl,
    analysis.audience.confidence,
    now,
  )

  const brand = mergeSection<BrandProfile>(
    existing.brand,
    hasBrand(analysis)
      ? {
          voice: analysis.brand.voice,
          personalityTraits: analysis.brand.personalityTraits,
          colors: existing.brand?.value.colors ?? [],
          logoUrl: existing.brand?.value.logoUrl ?? null,
          fontFamily: existing.brand?.value.fontFamily ?? null,
          visualStyle: analysis.brand.visualStyle,
          keyMessages: analysis.brand.keyMessages,
          valuePropositions: analysis.brand.valuePropositions,
        }
      : null,
    SECTION_SOURCES.brand,
    analysis.brand.sourceUrl ?? context.websiteUrl,
    analysis.brand.confidence,
    now,
  )

  const marketing = mergeSection<MarketingProfile>(
    existing.marketing,
    hasMarketing(analysis)
      ? {
          positioning: analysis.marketing.positioning,
          valueProposition: analysis.marketing.valueProposition,
          differentiators: analysis.marketing.differentiators,
          competitors: existing.marketing?.value.competitors ?? [],
          activeChannels: analysis.marketing.activeChannels,
          pastActivity: existing.marketing?.value.pastActivity ?? null,
          promotions: analysis.marketing.promotions,
          callsToAction: analysis.marketing.callsToAction,
          themes: analysis.marketing.themes,
          emphasizedProducts: analysis.marketing.emphasizedProducts,
        }
      : null,
    SECTION_SOURCES.marketing,
    analysis.marketing.sourceUrl ?? context.websiteUrl,
    analysis.marketing.confidence,
    now,
  )

  const operations = mergeSection<OperationsProfile>(
    existing.operations,
    hasOperations(analysis)
      ? {
          openingHours: analysis.operations.openingHours,
          orderingMethods: analysis.operations.orderingMethods,
          deliveryPlatforms: analysis.operations.deliveryPlatforms,
          reservations: analysis.operations.reservations,
          notes: analysis.operations.notes,
        }
      : null,
    SECTION_SOURCES.operations,
    analysis.operations.sourceUrl ?? context.websiteUrl,
    analysis.operations.confidence,
    now,
  )

  return {
    name,
    industry: analysis.identity.industry,
    identity,
    contact,
    location,
    products: mergeProducts(existing.products, analysis, context),
    audience,
    brand,
    marketing,
    operations,
    provenance,
    sources: upsertWebsiteSource(existing.sources, context),
    brainVersion: BRAIN_VERSION,
    updatedAt: now,
  }
}

/**
 * Section-level merge. A confirmed section is never replaced — that is the
 * "MARKA should not silently revert it to Friendly" rule.
 */
export function mergeSection<T>(
  existing: Discovered<T> | null,
  incomingValue: T | null,
  source: SourceKind,
  sourceRef: string | null,
  confidence: number,
  now: number,
): Discovered<T> | null {
  if (incomingValue === null) return existing

  const incoming = { source, confirmed: false, confidence }
  if (!outranks(incoming, claimOf(existing))) return existing

  return {
    value: incomingValue,
    source,
    sourceRef,
    confidence,
    confirmed: false,
    discoveredAt: now,
    confirmedAt: null,
  }
}

/**
 * Products are matched by name, because that is the only stable identifier a
 * website offers.
 *
 * Confirmed items survive untouched even if the site no longer lists them —
 * the owner may have corrected a price the website has not caught up with.
 * Unconfirmed items that vanish from the site are dropped, so a menu change is
 * reflected rather than accumulating stale dishes forever.
 */
export function mergeProducts(
  existing: Product[],
  analysis: WebsiteAnalysis,
  context: MergeContext,
): Product[] {
  const existingByKey = new Map(existing.map((product) => [productKey(product.name), product]))
  const merged: Product[] = []
  const usedKeys = new Set<string>()

  for (const incoming of analysis.products) {
    const key = productKey(incoming.name)
    usedKeys.add(key)
    const current = existingByKey.get(key)

    if (current?.confirmed) {
      merged.push(current)
      continue
    }

    merged.push({
      id: current?.id ?? productId(incoming.name, merged.length),
      name: incoming.name,
      description: incoming.description,
      priceMinor: toMinorUnits(incoming.price),
      currency: incoming.currency ?? 'MYR',
      category: incoming.category,
      imageUrl: current?.imageUrl ?? null,
      isSignature: incoming.isSignature,
      attributes: incoming.attributes,
      source: 'website',
      sourceRef: incoming.sourceUrl ?? context.websiteUrl,
      confidence: incoming.confidence,
      confirmed: false,
      confirmedAt: null,
    })
  }

  for (const product of existing) {
    if (usedKeys.has(productKey(product.name))) continue
    // Anything the owner stood behind stays, whatever the site now says.
    if (product.confirmed || product.source === 'user') merged.push(product)
  }

  return merged
}

/** Prices are stored in sen so arithmetic never drifts. */
export function toMinorUnits(price: number | null): number | null {
  if (price === null || !Number.isFinite(price)) return null
  return Math.round(price * 100)
}

export function productKey(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function productId(name: string, index: number): string {
  const slug = productKey(name).replace(/\s+/g, '-').slice(0, 32) || 'item'
  return `p_${slug}_${index}`
}

function upsertWebsiteSource(existing: ConnectedSource[], context: MergeContext): ConnectedSource[] {
  const others = existing.filter((source) => source.id !== 'website')
  return [
    ...others,
    {
      id: 'website',
      kind: 'website',
      label: 'Website',
      reference: context.websiteUrl,
      status: 'connected',
      lastSyncedAt: context.now,
    },
  ]
}

/* --- "did the model actually find anything?" --------------------------- */

function hasAudience(analysis: WebsiteAnalysis): boolean {
  const { summary, customerTypes, segments, needs, useCases, demographics, preferences } =
    analysis.audience
  return Boolean(
    summary ||
      customerTypes.length ||
      segments.length ||
      needs.length ||
      useCases.length ||
      demographics.length ||
      preferences.length,
  )
}

function hasBrand(analysis: WebsiteAnalysis): boolean {
  const { voice, personalityTraits, visualStyle, keyMessages, valuePropositions } = analysis.brand
  return Boolean(
    voice || personalityTraits.length || visualStyle || keyMessages.length || valuePropositions.length,
  )
}

function hasMarketing(analysis: WebsiteAnalysis): boolean {
  const m = analysis.marketing
  return Boolean(
    m.positioning ||
      m.valueProposition ||
      m.differentiators.length ||
      m.promotions.length ||
      m.callsToAction.length ||
      m.themes.length ||
      m.activeChannels.length ||
      m.emphasizedProducts.length,
  )
}

function hasOperations(analysis: WebsiteAnalysis): boolean {
  const o = analysis.operations
  return Boolean(
    o.openingHours ||
      o.orderingMethods.length ||
      o.deliveryPlatforms.length ||
      o.reservations ||
      o.notes.length,
  )
}

/** Re-exported so callers can iterate the same field list the merge uses. */
export { PROVENANCE_FIELDS }
