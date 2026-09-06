import type { DnaConfidence, DnaSourceType } from '../../lib/business.types'
import type { StoredAsset } from '../../creative/assets'
import type { SocialProfileContent } from '../discovery/fetchSocial'
import type { DiscoverySourceKind } from '../discovery/source'
import type { BrandVisual } from '../website/brandVisual'
import type { NormalizedSite } from '../website/normalize'

/**
 * Source evidence (Phase 7E): the one shape every business source is
 * reduced to before the model sees anything.
 *
 * A website, a Facebook Page, an Instagram profile and the owner's uploaded
 * Assets each produce a list of these. Nothing here is an instruction —
 * evidence is DATA, labelled by where it came from and how sure the reader
 * can be, and the prompt says exactly that. Bounds live here too: the corpus
 * budgets, the metadata caps and the number of images are decided by this
 * module, deterministically, never by the model.
 */

export type EvidenceKind = 'text' | 'meta' | 'color' | 'font' | 'logo' | 'image' | 'document'

/**
 *  deterministic  — read off markup by code (theme colour, icon link, font name)
 *  source_text    — the page's own words, to be read by the model
 *  asset_metadata — what the owner typed about an upload (name, type, tags)
 */
export type EvidenceProvenance = 'deterministic' | 'source_text' | 'asset_metadata'

export interface SourceEvidence {
  /** Stable within one run: e1, e2, … in build order. */
  id: string
  sourceType: DnaSourceType
  /** Canonical page URL, or the asset id. */
  sourceRef: string
  canonicalUrl: string | null
  kind: EvidenceKind
  /** Bounded text. */
  value: string
  confidence: DnaConfidence
  provenance: EvidenceProvenance
  metadata: Record<string, string | number | boolean>
  /** For image kinds: the URL the source exposed. Never model-supplied. */
  imageRef: string | null
  assetId: string | null
}

export type VisualRole = 'logo_candidate' | 'hero' | 'representative' | 'asset'

/** An image worth showing the model, before its bytes are fetched. */
export interface VisualCandidate {
  role: VisualRole
  sourceType: DnaSourceType
  /** Image URL for page sources; asset id for Assets. */
  ref: string
  assetId: string | null
  assetType: StoredAsset['type'] | null
  /** Human label for the prompt: what this image is, in the source's terms. */
  label: string
}

/** A candidate whose bytes the server fetched itself. */
export interface VisualEvidence extends VisualCandidate {
  /** img1, img2, … — the only way the model may refer to an image. */
  id: string
  contentType: string
  dataUrl: string
}

export interface SourceEvidenceSet {
  evidence: SourceEvidence[]
  visuals: VisualCandidate[]
}

/* --- bounds -------------------------------------------------------------- */

/** The crawler already budgets the corpus to 24k; this is a hard backstop. */
export const WEBSITE_CORPUS_CAP = 28_000
export const SOCIAL_CORPUS_CAP = 8_000
export const ASSET_METADATA_CAP = 200
/** How many Assets may contribute metadata lines. */
export const MAX_ASSET_METADATA = 12
/** The representative-image budget across all sources, per run. */
export const VISUAL_LIMITS = {
  logo: 1,
  hero: 1,
  representative: 2,
  asset: 3,
  total: 6,
} as const

/* --- website ------------------------------------------------------------- */

export function websiteEvidence(
  params: {
    site: NormalizedSite
    visual: BrandVisual | null
    canonicalUrl: string
  },
  ids: EvidenceIds = new EvidenceIds(),
): SourceEvidenceSet {
  const { site, visual, canonicalUrl } = params
  const evidence: SourceEvidence[] = []
  const visuals: VisualCandidate[] = []
  const base = { sourceType: 'website' as const, sourceRef: canonicalUrl, canonicalUrl }

  evidence.push(
    entry(ids, {
      ...base,
      kind: 'text',
      value: site.corpus.slice(0, WEBSITE_CORPUS_CAP),
      confidence: 'high',
      provenance: 'source_text',
      metadata: { pages: site.pageUrls.length },
    }),
  )

  if (site.signals.socialLinks.length > 0) {
    evidence.push(
      entry(ids, {
        ...base,
        kind: 'meta',
        value: `Social links in the markup: ${site.signals.socialLinks.slice(0, 10).join(', ')}`,
        confidence: 'high',
        provenance: 'deterministic',
      }),
    )
  }

  if (visual) {
    for (const color of visual.colors) {
      evidence.push(
        entry(ids, {
          ...base,
          kind: 'color',
          value: color.hex,
          confidence: 'high',
          provenance: 'deterministic',
          metadata: { label: color.label },
        }),
      )
    }
    if (visual.fontName || visual.fontFamily) {
      evidence.push(
        entry(ids, {
          ...base,
          kind: 'font',
          value: visual.fontName ?? visual.fontFamily ?? '',
          confidence: 'high',
          provenance: 'deterministic',
          metadata: visual.fontFamily ? { supportedMatch: visual.fontFamily } : {},
        }),
      )
    }
    if (visual.logoUrl) {
      evidence.push(
        entry(ids, {
          ...base,
          kind: 'logo',
          value: 'Icon or logo image linked from the site markup',
          confidence: 'medium',
          provenance: 'deterministic',
          imageRef: visual.logoUrl,
        }),
      )
      visuals.push({
        role: 'logo_candidate',
        sourceType: 'website',
        ref: visual.logoUrl,
        assetId: null,
        assetType: null,
        label: 'website icon / logo candidate',
      })
    }
  }

  // The OG image comes first in `signals.images` by construction (extract.ts).
  const images = uniqueUrls(site.signals.images).filter((url) => url !== visual?.logoUrl)
  const [hero, ...rest] = images
  if (hero) {
    visuals.push({
      role: 'hero',
      sourceType: 'website',
      ref: hero,
      assetId: null,
      assetType: null,
      label: 'website hero / share image',
    })
  }
  for (const url of rest.slice(0, VISUAL_LIMITS.representative)) {
    visuals.push({
      role: 'representative',
      sourceType: 'website',
      ref: url,
      assetId: null,
      assetType: null,
      label: 'image from a website page',
    })
  }

  return { evidence, visuals }
}

/* --- facebook / instagram ---------------------------------------------- */

export function socialEvidence(
  params: {
    kind: Exclude<DiscoverySourceKind, 'website'>
    profile: SocialProfileContent
    canonicalUrl: string
  },
  ids: EvidenceIds = new EvidenceIds(),
): SourceEvidenceSet {
  const { kind, profile, canonicalUrl } = params
  const evidence: SourceEvidence[] = []
  const visuals: VisualCandidate[] = []
  const base = { sourceType: kind, sourceRef: canonicalUrl, canonicalUrl }
  const label = kind === 'instagram' ? 'Instagram profile' : 'Facebook Page'

  evidence.push(
    entry(ids, {
      ...base,
      kind: 'text',
      value: profile.corpus.slice(0, SOCIAL_CORPUS_CAP),
      // A profile is the business describing itself, but it shows far less
      // than a website — medium, so the model keeps unknowns honest.
      confidence: 'medium',
      provenance: 'source_text',
      metadata: { platform: label },
    }),
  )

  if (profile.signals.outboundLinks.length > 0) {
    evidence.push(
      entry(ids, {
        ...base,
        kind: 'meta',
        value: `Links on the profile: ${profile.signals.outboundLinks.slice(0, 10).join(', ')}`,
        confidence: 'high',
        provenance: 'deterministic',
      }),
    )
  }

  // The OG image on a profile is almost always the profile picture — the
  // closest thing a social-only business has to a logo. A candidate only.
  const [picture] = uniqueUrls(profile.page?.images ?? [])
  if (picture) {
    evidence.push(
      entry(ids, {
        ...base,
        kind: 'image',
        value: `${label} picture`,
        confidence: 'medium',
        provenance: 'deterministic',
        imageRef: picture,
      }),
    )
    visuals.push({
      role: 'logo_candidate',
      sourceType: kind,
      ref: picture,
      assetId: null,
      assetType: null,
      label: `${label} picture (profile image)`,
    })
  }

  return { evidence, visuals }
}

/* --- assets --------------------------------------------------------------- */

export interface AssetForEvidence {
  id: string
  asset: StoredAsset
}

/** Asset types worth showing the model, best first. Documents are metadata only. */
const ASSET_VISUAL_ORDER: StoredAsset['type'][] = [
  'logo',
  'brand',
  'product',
  'photo',
  'promotional',
  'menu',
  'other',
]

export function assetEvidence(
  assets: AssetForEvidence[],
  ids: EvidenceIds = new EvidenceIds(),
): SourceEvidenceSet {
  const evidence: SourceEvidence[] = []
  const visuals: VisualCandidate[] = []

  const ordered = [...assets].sort(
    (a, b) =>
      rankAssetType(a.asset.type) - rankAssetType(b.asset.type) ||
      a.asset.createdAt - b.asset.createdAt ||
      a.id.localeCompare(b.id),
  )

  for (const { id, asset } of ordered.slice(0, MAX_ASSET_METADATA)) {
    const description = [
      `type: ${asset.type}`,
      asset.name ? `name: ${asset.name}` : null,
      asset.description ? `description: ${asset.description}` : null,
      asset.tags.length > 0 ? `tags: ${asset.tags.slice(0, 8).join(', ')}` : null,
    ]
      .filter((part): part is string => part !== null)
      .join('; ')
      .slice(0, ASSET_METADATA_CAP)

    evidence.push(
      entry(ids, {
        sourceType: 'asset',
        sourceRef: id,
        canonicalUrl: null,
        kind: asset.contentType === 'application/pdf' ? 'document' : 'image',
        value: description,
        // The owner labelled it themselves.
        confidence: 'high',
        provenance: 'asset_metadata',
        metadata: { assetType: asset.type, contentType: asset.contentType },
        assetId: id,
      }),
    )
  }

  for (const { id, asset } of ordered) {
    if (asset.contentType === 'application/pdf') continue
    visuals.push({
      role: asset.type === 'logo' ? 'logo_candidate' : 'asset',
      sourceType: 'asset',
      ref: id,
      assetId: id,
      assetType: asset.type,
      label: `uploaded asset "${asset.name || asset.fileName}" (owner labelled it: ${asset.type})`,
    })
  }

  return { evidence, visuals }
}

function rankAssetType(type: StoredAsset['type']): number {
  const index = ASSET_VISUAL_ORDER.indexOf(type)
  return index === -1 ? ASSET_VISUAL_ORDER.length : index
}

/* --- selection ------------------------------------------------------------ */

/** Which source wins a slot when several offer one. */
const SOURCE_PRIORITY: Record<DnaSourceType, number> = {
  website: 0,
  asset: 1,
  facebook: 2,
  instagram: 3,
}

/**
 * The bounded, representative set of images for ONE synthesis call, chosen
 * deterministically: one logo candidate, one hero image, a couple of
 * representative page images, a few Assets — de-duplicated by reference and
 * capped in total. The same inputs always pick the same images, so a re-run
 * costs the same and reads the same.
 */
export function selectVisualCandidates(candidates: VisualCandidate[]): VisualCandidate[] {
  const seen = new Set<string>()
  const chosen: VisualCandidate[] = []
  const take = (candidate: VisualCandidate | undefined) => {
    if (!candidate || seen.has(candidate.ref) || chosen.length >= VISUAL_LIMITS.total) return
    seen.add(candidate.ref)
    chosen.push(candidate)
  }
  const byPriority = (role: VisualRole) =>
    candidates
      .filter((candidate) => candidate.role === role)
      .sort((a, b) => SOURCE_PRIORITY[a.sourceType] - SOURCE_PRIORITY[b.sourceType])

  // The website's own icon outranks a logo-typed Asset for the *candidate*
  // slot only because it is what customers already see; the Asset still
  // reaches the model in its own slot below, and "official logo" is the
  // owner's call either way.
  byPriority('logo_candidate').slice(0, VISUAL_LIMITS.logo).forEach(take)
  byPriority('hero').slice(0, VISUAL_LIMITS.hero).forEach(take)
  byPriority('representative').slice(0, VISUAL_LIMITS.representative).forEach(take)

  const assetSlots = candidates.filter(
    (candidate) => candidate.sourceType === 'asset' && !seen.has(candidate.ref),
  )
  assetSlots.slice(0, VISUAL_LIMITS.asset).forEach(take)

  return chosen
}

/* --- helpers --------------------------------------------------------------- */

/** Hands out e1, e2, … across every builder in one run. */
export class EvidenceIds {
  private counter = 0
  next(): string {
    this.counter += 1
    return `e${this.counter}`
  }
}

function entry(
  ids: EvidenceIds,
  fields: Omit<SourceEvidence, 'id' | 'metadata' | 'imageRef' | 'assetId'> &
    Partial<Pick<SourceEvidence, 'metadata' | 'imageRef' | 'assetId'>>,
): SourceEvidence {
  return {
    id: ids.next(),
    metadata: {},
    imageRef: null,
    assetId: null,
    ...fields,
  }
}

export function uniqueUrls(urls: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const url of urls) {
    if (typeof url !== 'string') continue
    const key = url.trim()
    if (!key || !/^https?:\/\//i.test(key) || seen.has(key)) continue
    seen.add(key)
    out.push(key)
  }
  return out
}

/** Total characters of text evidence — what the request budget must cover. */
export function evidenceChars(evidence: SourceEvidence[]): number {
  return evidence.reduce((sum, item) => sum + item.value.length, 0)
}
