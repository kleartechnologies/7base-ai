import {
  BRAND_FONTS,
  BRAND_STYLE_TRAITS,
  type BrandFont,
  type BrandKit,
  type BrandStyleTrait,
  type StoredBusiness,
} from '../lib/business.types'
import { text } from './validate'

/**
 * Brand Identity resolution for creative generation (Phase 7D).
 *
 * The authoritative Brand Identity comes from the business document, which
 * only the owner can write and only through their own rules-checked path —
 * the generation request itself carries nothing but a campaign id and a
 * format, so a client cannot inject brand values into a creative. This module
 * still re-validates every field it reads (hexes re-parsed, fonts and traits
 * checked against the closed lists) so a malformed document degrades to
 * "no brand" instead of flowing raw strings into prompts.
 *
 * Resolution order everywhere: owner-set `brandKit` first, then the
 * discovered `brand` profile, then nothing. An incomplete kit contributes
 * whatever it has and never blocks generation.
 */

const HEX_RE = /^#?([0-9a-fA-F]{6})$/
const NOTES_LIMIT = 400

function cleanHex(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const digits = HEX_RE.exec(value.trim())?.[1]
  return digits ? `#${digits.toLowerCase()}` : null
}

function cleanFont(value: unknown): BrandFont | null {
  return typeof value === 'string' && (BRAND_FONTS as readonly string[]).includes(value)
    ? (value as BrandFont)
    : null
}

/** The owner's brand kit with every field re-validated, or null when unset. */
export function readBrandKit(business: StoredBusiness | null): BrandKit | null {
  const raw = business?.brandKit
  if (!raw || typeof raw !== 'object') return null
  const traits = Array.isArray(raw.styleTraits)
    ? raw.styleTraits
        .filter(
          (trait): trait is BrandStyleTrait =>
            typeof trait === 'string' &&
            (BRAND_STYLE_TRAITS as readonly string[]).includes(trait),
        )
        .slice(0, 4)
    : []
  return {
    logoAssetId:
      typeof raw.logoAssetId === 'string' && raw.logoAssetId.trim() ? raw.logoAssetId : null,
    colors: {
      primary: cleanHex(raw.colors?.primary),
      secondary: cleanHex(raw.colors?.secondary),
      accent: cleanHex(raw.colors?.accent),
    },
    typography: {
      heading: cleanFont(raw.typography?.heading),
      body: cleanFont(raw.typography?.body),
    },
    styleTraits: traits,
    styleNotes: text(raw.styleNotes, NOTES_LIMIT),
    notes: text(raw.notes, NOTES_LIMIT),
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : 0,
  }
}

export interface ResolvedBrandStyle {
  /** [primary, secondary, accent] when the kit is the source; discovery order otherwise. */
  palette: string[] | null
  headingFont: string | null
  bodyFont: string | null
  /** Which source won, so callers can stamp `brandApplied` honestly. */
  kitColors: boolean
  kitTypography: boolean
}

/** Poster palette and fonts: brand kit first, discovered brand as fallback. */
export function resolveBrandStyle(business: StoredBusiness | null): ResolvedBrandStyle {
  const kit = readBrandKit(business)
  const kitPalette = kit
    ? [kit.colors.primary, kit.colors.secondary, kit.colors.accent].filter(
        (hex): hex is string => hex !== null,
      )
    : []
  const discovered = business?.brand?.value ?? null
  const discoveredPalette = (discovered?.colors ?? [])
    .map((color) => cleanHex(color.hex))
    .filter((hex): hex is string => hex !== null)

  const kitColors = kitPalette.length > 0
  const palette = kitColors ? kitPalette : discoveredPalette.length > 0 ? discoveredPalette : null

  const kitTypography = Boolean(kit?.typography.heading || kit?.typography.body)
  return {
    palette,
    headingFont: kit?.typography.heading ?? discovered?.fontFamily ?? null,
    bodyFont: kit?.typography.body ?? null,
    kitColors,
    kitTypography,
  }
}

/**
 * The visual style line for image prompts: the owner's traits and style notes
 * when set ("modern, warm — hand-drawn chalk illustrations"), otherwise the
 * discovered `visualStyle`.
 */
export function resolveVisualStyle(business: StoredBusiness | null, limit: number): string | null {
  const kit = readBrandKit(business)
  if (kit && (kit.styleTraits.length > 0 || kit.styleNotes)) {
    const traits = kit.styleTraits.join(', ')
    const combined = [traits, kit.styleNotes].filter(Boolean).join(' — ')
    return text(combined, limit)
  }
  return text(business?.brand?.value.visualStyle ?? null, limit)
}

/**
 * One short line for the copy prompt describing the owner's brand style, so
 * written copy matches the visual identity ("premium, minimal") without a
 * second AI call. Null when the owner has set nothing.
 */
export function brandStyleLine(business: StoredBusiness | null): string | null {
  const kit = readBrandKit(business)
  if (!kit) return null
  const parts = [
    kit.styleTraits.length > 0 ? kit.styleTraits.join(', ') : null,
    kit.styleNotes,
    kit.notes,
  ].filter(Boolean)
  return parts.length > 0 ? text(parts.join('. '), NOTES_LIMIT) : null
}

/**
 * What the creative actually inherited from Brand Identity, stamped onto
 * `style.brandApplied` at generation time. Null when the owner has no kit at
 * all — the applied panel then simply does not render.
 */
export function brandAppliedSummary(
  business: StoredBusiness | null,
  applied: { logoFromKit: boolean; kitColors: boolean; kitTypography: boolean },
): { logo: boolean; colors: boolean; typography: boolean; style: boolean } | null {
  const kit = readBrandKit(business)
  if (!kit) return null
  return {
    logo: applied.logoFromKit,
    colors: applied.kitColors,
    typography: applied.kitTypography,
    style: kit.styleTraits.length > 0 || Boolean(kit.styleNotes),
  }
}
