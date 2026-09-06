import {
  BRAND_FONTS,
  BRAND_STYLE_TRAITS,
  BRAND_TRAITS_MAX,
  BRAND_TRAITS_MIN,
  type BrandFont,
  type BrandKit,
  type BrandStyleTrait,
  type Business,
  type BusinessDna,
  type DnaSourceSummary,
  type Millis,
} from '@/types'

/**
 * Brand Identity shaping, kept free of Firebase and the DOM so it can be
 * reasoned about and tested on its own — the same discipline as
 * `services/business/brain.ts`.
 *
 * Two rules run through this file:
 *  - **Completion is derived, never stored.** Readiness is computed from the
 *    fields every time; there is no `ready` boolean to drift out of sync.
 *  - **Discovered data never becomes Brand Identity silently.** The detected
 *    suggestion below only *describes* what discovery found; copying it into
 *    the kit happens when the owner presses "Use these", nowhere else.
 */

/** Soft cap on the free-text notes. Never gates readiness. */
export const BRAND_NOTES_SOFT_CAP = 300
/** The counter becomes visible once the owner passes this. */
export const BRAND_NOTES_COUNTER_AT = 250

export function emptyBrandKit(now: Millis = Date.now()): BrandKit {
  return {
    logoAssetId: null,
    colors: { primary: null, secondary: null, accent: null },
    typography: { heading: null, body: null },
    styleTraits: [],
    styleNotes: null,
    notes: null,
    updatedAt: now,
  }
}

/**
 * Normalises a hex colour the owner typed. Accepts `#RGB`, `RGB`, `#RRGGBB`
 * and `RRGGBB` in any case; returns lowercase `#rrggbb` (the stored form, and
 * the form `posterSpec.normalizeHex` parses) or null when the input is not a
 * colour.
 */
export function normalizeBrandHex(input: string): string | null {
  const raw = input.trim().replace(/^#/, '')
  if (/^[0-9a-fA-F]{6}$/.test(raw)) return `#${raw.toLowerCase()}`
  if (/^[0-9a-fA-F]{3}$/.test(raw)) {
    const [r, g, b] = raw.toLowerCase()
    return `#${r}${r}${g}${g}${b}${b}`
  }
  return null
}

export function isBrandFont(value: string | null | undefined): value is BrandFont {
  return typeof value === 'string' && (BRAND_FONTS as readonly string[]).includes(value)
}

export function isBrandTrait(value: string): value is BrandStyleTrait {
  return (BRAND_STYLE_TRAITS as readonly string[]).includes(value)
}

/** The five checklist rows the status card renders. Notes never gate `ready`. */
export interface BrandKitChecklist {
  logo: boolean
  colors: boolean
  typography: boolean
  style: boolean
  notes: boolean
}

export function brandKitChecklist(kit: BrandKit | null | undefined): BrandKitChecklist {
  return {
    logo: Boolean(kit?.logoAssetId),
    colors: Boolean(kit?.colors.primary && kit.colors.secondary && kit.colors.accent),
    typography: Boolean(kit?.typography.heading && kit.typography.body),
    style: (kit?.styleTraits.length ?? 0) >= BRAND_TRAITS_MIN,
    notes: Boolean(kit?.notes?.trim() || kit?.styleNotes?.trim()),
  }
}

export type BrandKitStatus = 'not_started' | 'partial' | 'ready'

/**
 * Derived completion. Ready = logo + all three colours + both fonts +
 * ≥2 traits. Notes are optional and never affect the outcome.
 */
export function brandKitStatus(kit: BrandKit | null | undefined): BrandKitStatus {
  const parts = brandKitChecklist(kit)
  if (parts.logo && parts.colors && parts.typography && parts.style) return 'ready'
  if (parts.logo || parts.colors || parts.typography || parts.style || parts.notes) {
    return 'partial'
  }
  return 'not_started'
}

/** How many of the five checklist rows are done, for the progress bar. */
export function brandKitProgress(kit: BrandKit | null | undefined): {
  done: number
  total: number
} {
  const parts = brandKitChecklist(kit)
  const done = [parts.logo, parts.colors, parts.typography, parts.style, parts.notes].filter(
    Boolean,
  ).length
  return { done, total: 5 }
}

/**
 * Whether adding `trait` to `selected` is allowed (max four), and whether
 * removing one is allowed (the UI enforces the minimum at save time, not per
 * click, so deselecting below two stays possible while editing).
 */
export function canSelectTrait(selected: BrandStyleTrait[], trait: BrandStyleTrait): boolean {
  return selected.includes(trait) || selected.length < BRAND_TRAITS_MAX
}

export function toggleTrait(
  selected: BrandStyleTrait[],
  trait: BrandStyleTrait,
): BrandStyleTrait[] {
  if (selected.includes(trait)) return selected.filter((item) => item !== trait)
  if (selected.length >= BRAND_TRAITS_MAX) return selected
  return [...selected, trait]
}

/**
 * What discovery found that the owner has not yet turned into Brand
 * Identity. Purely descriptive — nothing here is applied until the owner
 * confirms with "Use these".
 *
 * Two producers feed it. The Business DNA report (Phase 7E, `discovery.dna`)
 * is preferred: it carries a ranked palette, the font exactly as the source
 * named it, an Asset that looks like the logo, style words, and which
 * sources were read. Businesses analysed before 7E fall back to the brain's
 * discovered brand section (7D.1), which the same card has always shown.
 */
export interface DetectedBrandSuggestion {
  /** Up to three normalised hexes, strongest first. */
  colors: string[]
  /** A logo image a source exposed. Imported into Assets on "Use these". */
  logoUrl: string | null
  /** An Asset the owner already uploaded that looks like the logo (7E). */
  logoAssetId: string | null
  /**
   * The font exactly as the source named it. Shown honestly; it becomes a
   * Brand Kit font only when `supportedFont` is set, never by silent mapping.
   */
  fontFamily: string | null
  /** The approved-list match for `fontFamily`, when there is one. */
  supportedFont: BrandFont | null
  visualStyle: string | null
  /** Style words that map onto the closed trait list (7E). */
  traits: BrandStyleTrait[]
  /** What EVA understood the business to be (7E). Shown, not applied to the kit. */
  category: string | null
  /** Which sources the suggestion was read from (7E); empty for older runs. */
  sources: DnaSourceSummary[]
  /** Slots the analysis could not fill. Told plainly, never guessed. */
  unknown: DetectedBrandSlot[]
  source: 'website' | 'facebook' | 'instagram' | 'other' | 'sources'
}

export type DetectedBrandSlot = 'logo' | 'colors' | 'typography' | 'style'

export function detectedBrandSuggestion(
  business: Pick<Business, 'brand' | 'brandKit'> & { discovery?: Business['discovery'] | null },
): DetectedBrandSuggestion | null {
  const dna = business.discovery?.dna
  if (dna) return suggestionFromDna(dna, business.brandKit ?? null)

  const discovered = business.brand?.value
  if (!discovered) return null

  // Suppression is per field, not all-or-nothing (Phase 7D.1): each discovered
  // value goes quiet once the owner has filled its slot in the kit, and the
  // card shows whatever is left. Discovery often finds only some of the four —
  // a visual-style description without colours is still worth surfacing.
  const kit = business.brandKit ?? null

  const colors = kit?.colors.primary
    ? []
    : discovered.colors
        .map((color) => normalizeBrandHex(color.hex))
        .filter((hex): hex is string => hex !== null)
        .slice(0, 3)
  const logoUrl = kit?.logoAssetId ? null : discovered.logoUrl
  const fontFamily = kit?.typography.heading || kit?.typography.body ? null : discovered.fontFamily
  const visualStyle =
    kit?.styleNotes || (kit?.styleTraits.length ?? 0) > 0 ? null : discovered.visualStyle

  if (colors.length === 0 && !logoUrl && !fontFamily && !visualStyle) return null

  const source = business.brand?.source
  return {
    colors,
    logoUrl,
    logoAssetId: null,
    fontFamily,
    // Pre-7E discovery keeps its hint-only font: the card tells the owner to
    // pick the closest match, so "Use these" must not set one behind it.
    supportedFont: null,
    visualStyle,
    traits: [],
    category: null,
    sources: [],
    unknown: [],
    source:
      source === 'website' || source === 'facebook' || source === 'instagram' ? source : 'other',
  }
}

/**
 * The DNA report through the same per-field gate. A slot the owner already
 * filled is silent; a slot the analysis could not fill is listed as unknown
 * (unless the owner filled it, in which case there is nothing to say).
 */
function suggestionFromDna(dna: BusinessDna, kit: BrandKit | null): DetectedBrandSuggestion | null {
  const brand = dna.brand
  const kitHasColors = Boolean(kit?.colors.primary)
  const kitHasLogo = Boolean(kit?.logoAssetId)
  const kitHasFont = Boolean(kit?.typography.heading || kit?.typography.body)
  const kitHasStyle = Boolean(kit?.styleNotes || (kit?.styleTraits.length ?? 0) > 0)

  const colors = kitHasColors
    ? []
    : brand.colors
        .map((color) => normalizeBrandHex(color.hex))
        .filter((hex): hex is string => hex !== null)
        .filter((hex, index, all) => all.indexOf(hex) === index)
        .slice(0, 3)
  const logoCandidate = kitHasLogo ? null : brand.logoCandidate
  const logoAssetId = logoCandidate?.kind === 'asset' ? logoCandidate.assetId : null
  const logoUrl = logoCandidate?.kind === 'url' ? logoCandidate.url : null
  const fontFamily = kitHasFont ? null : brand.typography?.detectedFont ?? null
  const supportedFont = kitHasFont ? null : brand.typography?.supportedMatch ?? null
  const visualStyle = kitHasStyle ? null : brand.visualStyle
  const traits = kitHasStyle ? [] : brand.suggestedTraits.filter(isBrandTrait).slice(0, BRAND_TRAITS_MAX)

  const unknown: DetectedBrandSlot[] = []
  if (!kitHasLogo && !brand.logoCandidate) unknown.push('logo')
  if (!kitHasColors && brand.colors.length === 0) unknown.push('colors')
  if (!kitHasFont && !brand.typography) unknown.push('typography')
  if (!kitHasStyle && !brand.visualStyle && brand.suggestedTraits.length === 0) unknown.push('style')

  // Everything detected has been applied, or nothing was detected at all:
  // the card has nothing to offer and stays out of the way.
  const nothingLeft =
    colors.length === 0 &&
    !logoAssetId &&
    !logoUrl &&
    !fontFamily &&
    !visualStyle &&
    traits.length === 0
  if (nothingLeft) return null

  return {
    colors,
    logoUrl,
    logoAssetId,
    fontFamily,
    supportedFont,
    visualStyle,
    traits,
    category: dna.business.category,
    sources: dna.sources,
    unknown,
    source: 'sources',
  }
}

/**
 * The kit produced by "Use these": discovered colours seeded in order
 * (primary, secondary, accent), the discovered style description carried into
 * `styleNotes`, style words into the traits when the owner picked none, the
 * approved font into both slots when the owner set none, and an already
 * uploaded logo Asset referenced — never duplicated. A detected font with no
 * approved match stays a hint: the closed list is never bypassed and the name
 * is never swapped for a look-alike. A logo that is only a URL is handled by
 * the caller — it becomes an Asset first, then a reference. Nothing the owner
 * already set is overwritten.
 */
export function applyDetectedBrand(
  kit: BrandKit,
  suggestion: DetectedBrandSuggestion,
  now: Millis = Date.now(),
): BrandKit {
  const [primary, secondary, accent] = suggestion.colors
  const kitHasFont = Boolean(kit.typography.heading || kit.typography.body)
  const font = !kitHasFont && suggestion.supportedFont ? suggestion.supportedFont : null
  return {
    ...kit,
    logoAssetId: kit.logoAssetId ?? suggestion.logoAssetId ?? null,
    colors: {
      primary: kit.colors.primary ?? primary ?? null,
      secondary: kit.colors.secondary ?? secondary ?? null,
      accent: kit.colors.accent ?? accent ?? null,
    },
    typography: font ? { heading: font, body: font } : kit.typography,
    styleTraits:
      kit.styleTraits.length === 0 && suggestion.traits.length > 0
        ? suggestion.traits.slice(0, BRAND_TRAITS_MAX)
        : kit.styleTraits,
    styleNotes: kit.styleNotes ?? suggestion.visualStyle,
    updatedAt: now,
  }
}
