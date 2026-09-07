import type { Creative, CreativeDirection } from '@/types'
import { firstUsableColor, normalizeHex } from './posterSpec'

/**
 * The poster design system, as pure data (Phase 7G).
 *
 * A creative is structured — copy in fields, a visual with no words on it —
 * so every poster the owner sees is *composed* at render time. This module
 * makes the design decisions: which layout a creative direction calls for,
 * which colours play which role, how large the type runs for a given
 * headline. `posterDraw.ts` merely executes them on a canvas, and the same
 * execution serves the preview and the download — so the poster in the
 * chat, on the Creative page and in the downloaded file are one picture.
 *
 * Brand Identity constrains the design without becoming a template: the
 * brand colour is used for emphasis (the call to action, an eyebrow tag, a
 * panel) on neutral supporting surfaces; it is never the whole poster.
 */

export type PosterFormat = 'square_post' | 'portrait_post'

/**
 * The client-side arrangement a poster is drawn in.
 *
 * - editorial: the photo full-bleed, the message anchored bottom-left.
 * - showcase: a product/app shot presented as a card on a neutral ground,
 *   the message above or beside it.
 * - promo: photo on top, the offer on a brand-colour panel below.
 * - minimal: the photo framed in generous whitespace, quiet type below.
 * - typographic: no visual — a brand-colour ground carries the message.
 *
 * There is deliberately no "the model made the whole poster" arrangement:
 * the generated visual never carries words, so type and logo are always
 * ours to place.
 */
export type PosterLayout =
  | 'editorial'
  | 'showcase'
  | 'promo'
  | 'minimal'
  | 'typographic'

/** Everything the renderer needs, read from one persisted creative. */
export interface PosterInput {
  creativeId: string
  name: string
  format: PosterFormat
  headline: string | null
  subheadline: string | null
  callToAction: string | null
  offerText: string | null
  imageStoragePath: string | null
  imageAltText: string | null
  direction: CreativeDirection | null
  palette: string[] | null
  headingFont: string | null
  bodyFont: string | null
  logoStoragePath: string | null
}

/**
 * The one mapping from a persisted creative to what gets drawn. Every
 * surface — Creative page, chat cards, campaign page, download — goes
 * through here, which is what makes "same creative ⇒ same picture" a
 * property of the code rather than a hope.
 */
export function posterInput(creative: Creative): PosterInput {
  const image = creative.content.image
  return {
    creativeId: creative.id,
    name: creative.name,
    format: creative.format === 'portrait_post' ? 'portrait_post' : 'square_post',
    headline: creative.content.headline,
    subheadline: creative.content.subheadline,
    callToAction: creative.content.callToAction,
    offerText: creative.content.offerText,
    imageStoragePath: image?.storagePath ?? null,
    imageAltText: image?.altText ?? null,
    direction: creative.style.direction ?? null,
    palette: creative.style.palette,
    headingFont: creative.style.headingFont,
    bodyFont: creative.style.bodyFont,
    logoStoragePath: creative.style.logoStoragePath,
  }
}

export interface PosterPalette {
  /** The brand colour, or a neutral dark when the brand has none. */
  accent: string
  /** Whether `accent` really came from the brand. */
  accentFromBrand: boolean
  /** Readable text on `accent`. */
  accentText: string
  /** Text colours on the light ground. */
  ink: string
  inkSoft: string
  /** The light supporting surface. */
  paper: string
  /** The dark supporting surface. */
  dark: string
}

export interface PosterDesign {
  width: number
  height: number
  margin: number
  layout: PosterLayout
  palette: PosterPalette
  headingFont: string
  bodyFont: string
  /** The headline's base size for its length, before any fit scaling. */
  headlineSize: number
  supportingSize: number
  ctaSize: number
  eyebrowSize: number
}

export const POSTER_WIDTH = 1080
export const POSTER_MARGIN = 76

const NEUTRAL_ACCENT = '#1f2430'
const INK = '#14161c'
const INK_SOFT = 'rgba(20,22,28,0.68)'
const PAPER = '#f7f6f2'
const DARK = '#15171c'
const FONT_STACK = "-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"

export function posterHeight(format: PosterFormat): number {
  return format === 'portrait_post' ? 1350 : 1080
}

/** Which arrangement a creative is drawn in. */
export function layoutFor(input: {
  direction: CreativeDirection | null
  hasImage: boolean
}): PosterLayout {
  if (!input.hasImage) return 'typographic'
  switch (input.direction) {
    case 'hero_product':
    case 'app_showcase':
    case 'feature_highlight':
      return 'showcase'
    case 'bold_promotional':
      return 'promo'
    case 'educational':
    case 'minimal_premium':
      return 'minimal'
    case 'clean_editorial':
    case 'lifestyle':
    default:
      return 'editorial'
  }
}

export function posterPalette(palette: string[] | null): PosterPalette {
  const brand = firstUsableColor(palette)
  const accent = brand ?? NEUTRAL_ACCENT
  return {
    accent,
    accentFromBrand: brand !== null,
    accentText: readableOn(accent),
    ink: INK,
    inkSoft: INK_SOFT,
    paper: PAPER,
    dark: DARK,
  }
}

/**
 * Display size for a headline: short lines run large, longer ones step
 * down so three lines still fit. Measured in 1080-wide poster pixels.
 */
export function headlineSizeFor(headline: string | null): number {
  const length = (headline ?? '').trim().length
  if (length <= 14) return 96
  if (length <= 24) return 84
  if (length <= 36) return 72
  if (length <= 48) return 62
  return 54
}

export function posterDesign(input: PosterInput): PosterDesign {
  const layout = layoutFor({
    direction: input.direction,
    hasImage: input.imageStoragePath !== null,
  })
  return {
    width: POSTER_WIDTH,
    height: posterHeight(input.format),
    margin: POSTER_MARGIN,
    layout,
    palette: posterPalette(input.palette),
    headingFont: fontFamily(input.headingFont),
    bodyFont: fontFamily(input.bodyFont),
    headlineSize: headlineSizeFor(input.headline),
    supportingSize: 34,
    ctaSize: 30,
    eyebrowSize: 26,
  }
}

function fontFamily(font: string | null): string {
  return font ? `'${font}', ${FONT_STACK}` : FONT_STACK
}

/* --- colour helpers --------------------------------------------------------- */

export function withAlpha(hex: string, alpha: number): string {
  const rgb = toRgb(hex)
  if (!rgb) return `rgba(0,0,0,${alpha})`
  return `rgba(${rgb.r},${rgb.g},${rgb.b},${alpha})`
}

export function mixHex(from: string, to: string, amount: number): string {
  const a = toRgb(from)
  const b = toRgb(to)
  if (!a || !b) return from
  const channel = (x: number, y: number) => Math.round(x + (y - x) * amount)
  return rgbToHex(channel(a.r, b.r), channel(a.g, b.g), channel(a.b, b.b))
}

/** WCAG contrast ratio between two colours (1–21). */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  const light = Math.max(la, lb)
  const darkL = Math.min(la, lb)
  return (light + 0.05) / (darkL + 0.05)
}

export function relativeLuminance(hex: string): number {
  const rgb = toRgb(hex)
  if (!rgb) return 0
  const lin = (c: number) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(rgb.r) + 0.7152 * lin(rgb.g) + 0.0722 * lin(rgb.b)
}

/** White or near-black, whichever reads better on the colour. */
export function readableOn(hex: string): string {
  return contrastRatio(hex, '#ffffff') >= contrastRatio(hex, INK) ? '#ffffff' : INK
}

/**
 * The colour to write with on a given ground: the brand accent when it
 * carries enough contrast, otherwise the ground's own readable ink. Keeps a
 * pastel brand from vanishing on paper and a navy from vanishing on dark.
 */
export function emphasisOn(ground: string, accent: string, fallback: string): string {
  return contrastRatio(ground, accent) >= 3 ? accent : fallback
}

function toRgb(hex: string): { r: number; g: number; b: number } | null {
  const normalized = normalizeHex(hex)
  if (!normalized) return null
  return {
    r: parseInt(normalized.slice(1, 3), 16),
    g: parseInt(normalized.slice(3, 5), 16),
    b: parseInt(normalized.slice(5, 7), 16),
  }
}

function rgbToHex(r: number, g: number, b: number): string {
  const part = (v: number) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')
  return `#${part(r)}${part(g)}${part(b)}`
}
