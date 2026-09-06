import {
  BRAND_FONTS,
  BRAND_STYLE_TRAITS,
  BRAND_TRAITS_MAX,
  BRAND_TRAITS_MIN,
  type BrandFont,
  type BrandKit,
  type BrandStyleTrait,
  type Business,
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
 * What discovery (Phase 6D/6G) found that the owner has not yet turned into
 * Brand Identity. Purely descriptive — nothing here is applied until the
 * owner confirms with "Use these".
 */
export interface DetectedBrandSuggestion {
  /** Up to three normalised hexes, in discovery order. */
  colors: string[]
  logoUrl: string | null
  /** Shown as a hint only — free text never auto-maps onto the closed font list. */
  fontFamily: string | null
  visualStyle: string | null
  source: 'website' | 'facebook' | 'instagram' | 'other'
}

export function detectedBrandSuggestion(
  business: Pick<Business, 'brand' | 'brandKit'>,
): DetectedBrandSuggestion | null {
  const discovered = business.brand?.value
  if (!discovered) return null
  // Only surface while the kit has not been seeded: once the owner has set
  // colours or a logo themselves, the card would just be noise.
  const kit = business.brandKit ?? null
  if (kit && (kit.logoAssetId || kit.colors.primary)) return null

  const colors = discovered.colors
    .map((color) => normalizeBrandHex(color.hex))
    .filter((hex): hex is string => hex !== null)
    .slice(0, 3)
  const logoUrl = discovered.logoUrl
  if (colors.length === 0 && !logoUrl) return null

  const source = business.brand?.source
  return {
    colors,
    logoUrl,
    fontFamily: discovered.fontFamily,
    visualStyle: discovered.visualStyle,
    source:
      source === 'website' || source === 'facebook' || source === 'instagram' ? source : 'other',
  }
}

/**
 * The kit produced by "Use these": discovered colours seeded in order
 * (primary, secondary, accent), the discovered style description carried into
 * `styleNotes`. The font stays a hint (closed list; never auto-applied) and
 * the logo is handled separately — it becomes an Asset first, then a
 * reference.
 */
export function applyDetectedBrand(
  kit: BrandKit,
  suggestion: DetectedBrandSuggestion,
  now: Millis = Date.now(),
): BrandKit {
  const [primary, secondary, accent] = suggestion.colors
  return {
    ...kit,
    colors: {
      primary: primary ?? kit.colors.primary,
      secondary: secondary ?? kit.colors.secondary,
      accent: accent ?? kit.colors.accent,
    },
    styleNotes: kit.styleNotes ?? suggestion.visualStyle,
    updatedAt: now,
  }
}
