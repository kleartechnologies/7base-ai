import {
  BRAND_FONTS,
  BRAND_STYLE_TRAITS,
  type BrandFont,
  type BrandStyleTrait,
  type DnaConfidence,
} from '../../lib/business.types'
import { list, text, validateWebsiteAnalysis, type WebsiteAnalysis } from '../brain/validate'
import { isBrandLike, normalizeCssColor } from '../website/brandVisual'

/**
 * Strict validation of the model's Business DNA (Phase 7E).
 *
 * The base analysis goes through `validateWebsiteAnalysis` unchanged. The
 * `brandDna` block is validated against the EVIDENCE, not just its shape:
 *
 *  - a logo may only be one of the images the server attached (by id);
 *  - a colour must parse and look brand-like (white/black/grey out);
 *  - a font must be one the evidence actually named — the model cannot
 *    introduce "Plus Jakarta Sans" from a picture, only repeat it from
 *    markup — and it is kept exactly as written, never mapped onto the
 *    approved list silently. The approved match is recorded beside it.
 *
 * Anything that fails becomes null or is dropped. Nothing is invented to
 * fill a gap.
 */

export interface ValidatedBrandDna {
  logoImageId: string | null
  colors: { hex: string; confidence: DnaConfidence; seenIn: string }[]
  detectedFont: string | null
  supportedFont: BrandFont | null
  typographyNotes: string | null
  visualStyle: string | null
  styleTraits: string[]
  suggestedTraits: BrandStyleTrait[]
  imageryStyle: string | null
  compositionStyle: string | null
  visualMood: string | null
  confidence: DnaConfidence
}

export interface BusinessDnaAnalysis extends WebsiteAnalysis {
  brandDna: ValidatedBrandDna
}

export interface DnaValidationContext {
  /** Ids of the images the server attached (img1, …). */
  imageIds: string[]
  /** Font names the evidence stated, exactly as written. */
  fontNames: string[]
}

const LIMITS = {
  colors: 5,
  styleTraits: 6,
  styleTrait: 30,
  description: 160,
  fontName: 40,
  seenIn: 20,
} as const

const CONFIDENCE_LEVELS: DnaConfidence[] = ['high', 'medium', 'low']

export function validateBusinessDna(raw: unknown, context: DnaValidationContext): BusinessDnaAnalysis {
  const base = validateWebsiteAnalysis(raw)
  const block = isRecord(raw) && isRecord(raw.brandDna) ? raw.brandDna : {}
  return { ...base, brandDna: validateBrandDna(block, context) }
}

export function validateBrandDna(
  block: Record<string, unknown>,
  context: DnaValidationContext,
): ValidatedBrandDna {
  const imageIds = new Set(context.imageIds)
  const logoImageId =
    typeof block.logoImageId === 'string' && imageIds.has(block.logoImageId)
      ? block.logoImageId
      : null

  const colors: ValidatedBrandDna['colors'] = []
  const seenHex = new Set<string>()
  if (Array.isArray(block.colors)) {
    for (const item of block.colors) {
      if (!isRecord(item) || typeof item.hex !== 'string') continue
      const hex = normalizeCssColor(item.hex)
      if (!hex || !isBrandLike(hex) || seenHex.has(hex)) continue
      seenHex.add(hex)
      colors.push({
        hex,
        confidence: confidenceLevel(item.confidence),
        seenIn: text(item.seenIn, LIMITS.seenIn) ?? 'unknown',
      })
      if (colors.length >= LIMITS.colors) break
    }
  }

  const fontClaim = text(block.detectedFont, LIMITS.fontName)
  const detectedFont =
    fontClaim && context.fontNames.some((name) => sameFont(name, fontClaim))
      ? // Keep the evidence's spelling, not the model's.
        (context.fontNames.find((name) => sameFont(name, fontClaim)) ?? fontClaim)
      : null
  const supportedFont = detectedFont
    ? (BRAND_FONTS.find((font) => sameFont(font, detectedFont)) ?? null)
    : null

  const styleTraits = list(block.styleTraits, LIMITS.styleTrait).slice(0, LIMITS.styleTraits)

  return {
    logoImageId,
    colors,
    detectedFont,
    supportedFont,
    typographyNotes: text(block.typographyNotes, LIMITS.description),
    visualStyle: text(block.visualStyle, LIMITS.description),
    styleTraits,
    suggestedTraits: mapTraits(styleTraits),
    imageryStyle: text(block.imageryStyle, LIMITS.description),
    compositionStyle: text(block.compositionStyle, LIMITS.description),
    visualMood: text(block.visualMood, LIMITS.description),
    confidence: confidenceLevel(block.confidence),
  }
}

/**
 * The model's free-text traits mapped onto the closed Brand Kit list — by
 * exact word only, plus a few plain synonyms. Unmapped traits are kept as
 * words for the owner to read; they are never forced into the enum.
 */
const TRAIT_SYNONYMS: Record<string, BrandStyleTrait> = {
  modern: 'modern',
  contemporary: 'modern',
  premium: 'premium',
  luxury: 'premium',
  luxurious: 'premium',
  upscale: 'premium',
  friendly: 'friendly',
  approachable: 'friendly',
  welcoming: 'friendly',
  playful: 'playful',
  fun: 'playful',
  minimal: 'minimal',
  minimalist: 'minimal',
  clean: 'minimal',
  bold: 'bold',
  vibrant: 'bold',
  elegant: 'elegant',
  refined: 'elegant',
  sophisticated: 'elegant',
  warm: 'warm',
  homely: 'warm',
  cosy: 'warm',
  cozy: 'warm',
  traditional: 'traditional',
  heritage: 'traditional',
  classic: 'traditional',
  rustic: 'traditional',
  professional: 'professional',
  corporate: 'professional',
}

export function mapTraits(traits: string[]): BrandStyleTrait[] {
  const mapped: BrandStyleTrait[] = []
  for (const trait of traits) {
    const key = trait.toLowerCase().trim()
    const hit = TRAIT_SYNONYMS[key]
    if (hit && (BRAND_STYLE_TRAITS as readonly string[]).includes(hit) && !mapped.includes(hit)) {
      mapped.push(hit)
    }
    if (mapped.length >= 4) break
  }
  return mapped
}

function confidenceLevel(value: unknown): DnaConfidence {
  return typeof value === 'string' && (CONFIDENCE_LEVELS as string[]).includes(value)
    ? (value as DnaConfidence)
    : 'low'
}

function sameFont(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
