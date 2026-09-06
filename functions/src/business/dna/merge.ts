import type {
  BrandColor,
  StoredBusiness,
  BusinessDna,
  DetectedBrandDna,
  DetectedBusinessDna,
  DetectedColor,
  DetectedLogoCandidate,
  DnaConfidence,
  DnaSourceSummary,
  DnaSourceType,
} from '../../lib/business.types'
import type { BrandVisual } from '../website/brandVisual'
import {
  upsertDiscoverySource,
  withAnalysedProfile,
  type BrainPatch,
  type DiscoveredFrom,
} from '../brain/merge'
import type { SourceEvidence, VisualEvidence } from './evidence'
import type { BusinessDnaAnalysis } from './validate'

/**
 * From a validated Business DNA analysis to the two things the rest of the
 * system understands (Phase 7E):
 *
 *  1. a `BrandVisual` for the EXISTING brain merge — deterministic colours
 *     first, then what the model observed; a logo URL only when it came
 *     from a source the server fetched; the approved font, when there is
 *     one. `mergeWebsiteAnalysis` + `fillEmptyBrandVisuals` (7D.2) then do
 *     exactly what they always did, so authority (owner-confirmed > source
 *     > inference) is enforced in one place, not two;
 *
 *  2. the `BusinessDna` record stored under `discovery.dna`: the detected
 *     values with their provenance, for the review card. It is a REPORT.
 *     Nothing in it reaches the Brand Kit until the owner clicks "Use these".
 */

/** How many colours the brain's brand section carries. Same cap as 7D.1. */
const MAX_BRAIN_COLORS = 3
const MAX_DNA_COLORS = 5

export interface DnaMergeInput {
  analysis: BusinessDnaAnalysis
  sources: DnaSourceSummary[]
  evidence: SourceEvidence[]
  visuals: VisualEvidence[]
  /** Deterministic extraction from the website homepage, when there was one. */
  websiteVisual: BrandVisual | null
  now: number
}

/** The brain's source reference when only uploaded Assets were read. */
export const ASSETS_SOURCE_REF = 'uploaded-assets'

export interface PageSourceStamp {
  kind: DiscoveredFrom
  reference: string
}

/**
 * The page the brain merge is stamped with: the website when it was read,
 * otherwise the first social page that was, otherwise the owner's uploads
 * (`document`, which has no URL). Null only when nothing was readable.
 */
export function primarySource(sources: DnaSourceSummary[]): PageSourceStamp | null {
  const stamps = analysedSources(sources)
  return stamps[0] ?? null
}

/** Every readable page source in stamp order, then the uploads. */
export function analysedSources(sources: DnaSourceSummary[]): PageSourceStamp[] {
  const order: Exclude<DiscoveredFrom, 'document'>[] = ['website', 'facebook', 'instagram']
  const stamps: PageSourceStamp[] = []
  for (const kind of order) {
    const hit = sources.find(
      (source) => source.type === kind && source.status === 'analyzed' && source.reference,
    )
    if (hit?.reference) stamps.push({ kind, reference: hit.reference })
  }
  const assets = sources.find((source) => source.type === 'asset' && source.status === 'analyzed')
  if (assets) stamps.push({ kind: 'document', reference: ASSETS_SOURCE_REF })
  return stamps
}

/**
 * `mergeWebsiteAnalysis` records ONE source per run. A DNA run may have read
 * several, so the others are added afterwards the same way: one
 * ConnectedSource per kind, and each analysed social page joins the social
 * profiles unless it is already listed. Owner-confirmed values are not
 * involved — this touches the sources list and profile list only.
 */
export function stampAdditionalSources(
  patch: BrainPatch,
  stored: StoredBusiness,
  stamps: PageSourceStamp[],
  now: number,
): BrainPatch {
  let sources = patch.sources ?? stored.sources
  let contact = patch.contact ?? stored.contact
  for (const stamp of stamps) {
    sources = upsertDiscoverySource(
      sources,
      { websiteUrl: stamp.reference, pagesAnalysed: 0, now },
      stamp.kind,
    )
    contact = {
      ...contact,
      socialProfiles: withAnalysedProfile(contact.socialProfiles, stamp.kind, stamp.reference),
    }
  }
  return { ...patch, sources, contact }
}

/**
 * Colours ranked for the review card: deterministic markup colours (high,
 * extracted) first, then the model's observations. Deduplicated by hex.
 */
export function rankColors(input: DnaMergeInput): DetectedColor[] {
  const ranked: DetectedColor[] = []
  const seen = new Set<string>()

  const push = (color: DetectedColor) => {
    if (seen.has(color.hex) || ranked.length >= MAX_DNA_COLORS) return
    seen.add(color.hex)
    ranked.push(color)
  }

  for (const color of input.websiteVisual?.colors ?? []) {
    push({ hex: color.hex, confidence: 'high', provenance: 'extracted', source: 'website' })
  }

  const imageSource = new Map(input.visuals.map((visual) => [visual.id, visual.sourceType]))
  for (const color of input.analysis.brandDna.colors) {
    push({
      hex: color.hex,
      confidence: color.confidence,
      provenance: 'observed',
      source: imageSource.get(color.seenIn) ?? fallbackSource(input.sources),
    })
  }

  return ranked
}

/**
 * The logo candidate the model pointed at, resolved back to what the server
 * actually attached. An asset stays an asset reference (no duplication); a
 * page image keeps the URL the source exposed. When the model named nothing
 * but the website markup declared an icon, that is the candidate.
 */
export function logoCandidate(input: DnaMergeInput): DetectedLogoCandidate | null {
  const picked = input.analysis.brandDna.logoImageId
    ? input.visuals.find((visual) => visual.id === input.analysis.brandDna.logoImageId)
    : undefined

  if (picked) {
    if (picked.assetId) {
      return {
        kind: 'asset',
        assetId: picked.assetId,
        url: null,
        source: 'asset',
        confidence: picked.assetType === 'logo' ? 'high' : 'medium',
      }
    }
    return {
      kind: 'url',
      assetId: null,
      url: picked.ref,
      source: picked.sourceType,
      confidence: picked.role === 'logo_candidate' ? 'high' : 'medium',
    }
  }

  // A logo-typed Asset the owner labelled is a strong candidate on its own.
  const labelledLogo = input.visuals.find((visual) => visual.assetType === 'logo')
  if (labelledLogo?.assetId) {
    return {
      kind: 'asset',
      assetId: labelledLogo.assetId,
      url: null,
      source: 'asset',
      confidence: 'high',
    }
  }

  if (input.websiteVisual?.logoUrl) {
    return {
      kind: 'url',
      assetId: null,
      url: input.websiteVisual.logoUrl,
      source: 'website',
      confidence: 'medium',
    }
  }

  return null
}

/**
 * What the existing brain merge consumes. Colours become labelled brand
 * colours (the label is the source, which is what the 7D card shows); the
 * logo is a URL only — the brain never held asset ids, and an Asset logo is
 * offered through the DNA card instead; the font is the APPROVED match or
 * nothing, with the raw name carried in `fontName` for honesty.
 */
export function toBrandVisual(input: DnaMergeInput): BrandVisual {
  const colors: BrandColor[] = rankColors(input)
    .slice(0, MAX_BRAIN_COLORS)
    .map((color) => ({ label: colorLabel(color), hex: color.hex }))

  const logo = logoCandidate(input)
  const detectedFont = input.analysis.brandDna.detectedFont ?? input.websiteVisual?.fontName ?? null

  return {
    colors,
    logoUrl: logo?.kind === 'url' ? logo.url : input.websiteVisual?.logoUrl ?? null,
    fontFamily: input.analysis.brandDna.supportedFont ?? input.websiteVisual?.fontFamily ?? null,
    fontName: detectedFont,
  }
}

function colorLabel(color: DetectedColor): string {
  if (color.provenance === 'extracted') return 'Theme color'
  const names: Record<DnaSourceType, string> = {
    website: 'Website',
    facebook: 'Facebook',
    instagram: 'Instagram',
    asset: 'Uploaded asset',
  }
  return names[color.source]
}

export function buildBusinessDna(input: DnaMergeInput): BusinessDna {
  const { analysis } = input
  const brandDna = analysis.brandDna
  const fontSource = fontSourceFor(input)

  const brand: DetectedBrandDna = {
    logoCandidate: logoCandidate(input),
    colors: rankColors(input),
    typography:
      brandDna.detectedFont !== null || input.websiteVisual?.fontName
        ? {
            detectedFont: (brandDna.detectedFont ?? input.websiteVisual?.fontName) as string,
            supportedMatch: brandDna.supportedFont ?? input.websiteVisual?.fontFamily ?? null,
            source: fontSource,
            confidence: 'high',
          }
        : null,
    visualStyle: brandDna.visualStyle ?? analysis.brand.visualStyle,
    styleTraits: brandDna.styleTraits,
    suggestedTraits: brandDna.suggestedTraits,
    imageryStyle: brandDna.imageryStyle,
    compositionStyle: brandDna.compositionStyle,
    visualMood: brandDna.visualMood,
    confidence: brandDna.confidence,
  }

  const business: DetectedBusinessDna = {
    businessName: analysis.identity.businessName,
    category: analysis.identity.category ?? analysis.identity.subIndustry,
    productsServices: analysis.products.map((product) => product.name),
    bestSellers: bestSellers(analysis),
    targetAudience: analysis.audience.summary,
    location: locationLine(analysis),
    positioning: analysis.marketing.positioning,
    valueProposition: analysis.marketing.valueProposition,
    differentiators: analysis.marketing.differentiators,
    tagline: analysis.identity.tagline,
    keyMessages: analysis.brand.keyMessages,
    tone: analysis.brand.voice,
    personalityTraits: analysis.brand.personalityTraits,
    description: analysis.identity.description,
  }

  return {
    version: 1,
    analysedAt: input.now,
    sources: input.sources,
    business,
    brand,
    unknowns: analysis.unknowns,
  }
}

function bestSellers(analysis: BusinessDnaAnalysis): string[] {
  const signature = analysis.products.filter((product) => product.isSignature).map((p) => p.name)
  const seen = new Set<string>()
  const merged: string[] = []
  for (const name of [...analysis.marketing.emphasizedProducts, ...signature]) {
    const key = name.trim().toLowerCase()
    if (!key || seen.has(key)) continue
    seen.add(key)
    merged.push(name.trim())
  }
  return merged.slice(0, 8)
}

function locationLine(analysis: BusinessDnaAnalysis): string | null {
  const parts = [analysis.location.city, analysis.location.state].filter(
    (part): part is string => Boolean(part),
  )
  if (parts.length > 0) return parts.join(', ')
  return analysis.location.serviceArea ?? analysis.location.addressLine1
}

/** Where the named font came from: always markup — a picture cannot name a font. */
function fontSourceFor(input: DnaMergeInput): DnaSourceType {
  const named = input.evidence.find((item) => item.kind === 'font')
  return named?.sourceType ?? 'website'
}

function fallbackSource(sources: DnaSourceSummary[]): DnaSourceType {
  const analysed = sources.find((source) => source.status === 'analyzed')
  return analysed?.type ?? 'website'
}

/** Confidence for a source summary, from how much of it EVA could read. */
export function confidenceFor(status: DnaSourceSummary['status']): DnaConfidence {
  return status === 'analyzed' ? 'high' : status === 'limited' ? 'medium' : 'low'
}
