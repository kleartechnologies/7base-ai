import type {
  Creative,
  CreativeDirection,
  PosterAccentTreatment,
  PosterComposition,
  PosterCtaStyle,
} from '@/types'
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
 * These are not five styles picked after the fact: each one is the type half
 * of a composition the image was *briefed* for. A photograph shot with its
 * subject on the right and falloff on the left is typeset left; a screenshot
 * is stood up in the phone the scene left empty. The renderer executes the
 * arrangement; it never second-guesses which one it was given.
 *
 * - editorial: full-bleed photo, the message anchored in its quiet corner.
 * - split: photo and message each own a band of the poster, hard edge between.
 * - card: the photo inset as a card on a brand ground, message beneath.
 * - band: photo above, the offer on a shaped brand band below.
 * - device: the owner's screen stood in the scene, message beside or above.
 * - typographic: no visual — a brand ground carries the message alone.
 *
 * There is deliberately no "the model made the whole poster" arrangement:
 * the generated visual never carries words, so type and logo are always ours
 * to place.
 */
export type PosterLayout =
  | 'editorial'
  | 'split'
  | 'card'
  | 'band'
  | 'device'
  | 'typographic'

/**
 * Where the message sits relative to the picture. Read straight from the
 * composition, because the composition is what the photograph was framed for.
 */
export type MessageAnchor =
  | 'bottom_left'
  | 'bottom_center'
  | 'left'
  | 'right'
  | 'top'
  | 'center'

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
  /** The owner's real screen, stood in the generated scene. */
  deviceStoragePath: string | null
  direction: CreativeDirection | null
  /** How the image was briefed to be composed. Null on pre-7G.1 creatives. */
  composition: PosterComposition | null
  accentTreatment: PosterAccentTreatment | null
  ctaStyle: PosterCtaStyle | null
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
    deviceStoragePath: creative.content.deviceImage?.storagePath ?? null,
    direction: creative.style.direction ?? null,
    composition: creative.style.artDirection?.composition ?? null,
    accentTreatment: creative.style.artDirection?.accent ?? null,
    ctaStyle: creative.style.artDirection?.cta ?? null,
    palette: creative.style.palette,
    headingFont: creative.style.headingFont,
    bodyFont: creative.style.bodyFont,
    logoStoragePath: creative.style.logoStoragePath,
  }
}

export interface PosterPalette {
  /** The brand colour as given — for fills, where contrast is the text's job. */
  accent: string
  /** Whether `accent` really came from the brand. */
  accentFromBrand: boolean
  /** Readable text on `accent`. */
  accentText: string
  /**
   * The brand colour darkened until it can be *written with* on paper.
   *
   * A brand green like #22c55e carries about 1.8:1 against near-white, so the
   * old code quietly dropped it for plain ink and the brand disappeared from
   * every light poster. Deepening the same hue keeps the brand legible instead
   * of discarding it — it still reads as the brand, because it is.
   */
  accentInk: string
  /** The same, lightened until it can be written with on the dark ground. */
  accentOnDark: string
  /** Text colours on the light ground. */
  ink: string
  inkSoft: string
  /** The light supporting surface. */
  paper: string
  /** A tinted paper — the brand at a whisper, for card and split grounds. */
  paperTint: string
  /** The dark supporting surface, carrying a trace of the brand hue. */
  dark: string
}

export interface PosterDesign {
  width: number
  height: number
  margin: number
  layout: PosterLayout
  /** The composition the image was made for; the layout is derived from it. */
  composition: PosterComposition
  anchor: MessageAnchor
  accentTreatment: PosterAccentTreatment
  ctaStyle: PosterCtaStyle
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

/**
 * The composition a creative is drawn in.
 *
 * Normally the server already decided this in the same breath as the image
 * brief, and we simply obey it. Creatives made before Phase 7G.1 carry no art
 * direction, so a composition is derived from the direction they do carry —
 * they were shot without one in mind, so they get the most forgiving framing.
 */
export function compositionFor(input: {
  direction: CreativeDirection | null
  composition: PosterComposition | null
  hasImage: boolean
  hasDevice: boolean
}): PosterComposition {
  if (!input.hasImage) return 'typographic'
  if (input.composition) {
    // A device composition with no device to stand in it would draw an empty
    // phone. Fall back to the photograph's own framing.
    if (!input.hasDevice && DEVICE_LAYOUT[input.composition]) return 'hero_right'
    return input.composition
  }
  switch (input.direction) {
    case 'bold_promotional':
      return 'bottom_band'
    case 'hero_product':
    case 'app_showcase':
    case 'feature_highlight':
      return 'card_overlay'
    case 'educational':
    case 'minimal_premium':
      return 'editorial_split'
    case 'clean_editorial':
    case 'lifestyle':
    default:
      return 'full_bleed'
  }
}

const DEVICE_LAYOUT: Partial<Record<PosterComposition, true>> = {
  device_beside: true,
  device_hero: true,
  device_stack: true,
}

const LAYOUT_FOR: Record<PosterComposition, PosterLayout> = {
  full_bleed: 'editorial',
  hero_right: 'editorial',
  hero_left: 'editorial',
  center_hero: 'editorial',
  editorial_split: 'split',
  bottom_band: 'band',
  card_overlay: 'card',
  device_beside: 'device',
  device_hero: 'device',
  device_stack: 'device',
  typographic: 'typographic',
}

/**
 * Where the message goes. `hero_right` means the *subject* is on the right,
 * so the type takes the left — the anchor is the mirror of the subject, not
 * a repeat of it.
 */
const ANCHOR_FOR: Record<PosterComposition, MessageAnchor> = {
  full_bleed: 'bottom_left',
  hero_right: 'left',
  hero_left: 'right',
  center_hero: 'bottom_center',
  editorial_split: 'top',
  bottom_band: 'bottom_center',
  card_overlay: 'bottom_left',
  device_beside: 'left',
  device_hero: 'top',
  device_stack: 'left',
  typographic: 'center',
}

/** Which arrangement a creative is drawn in. */
export function layoutFor(input: {
  direction: CreativeDirection | null
  composition?: PosterComposition | null
  hasImage: boolean
  hasDevice?: boolean
}): PosterLayout {
  return LAYOUT_FOR[
    compositionFor({
      direction: input.direction,
      composition: input.composition ?? null,
      hasImage: input.hasImage,
      hasDevice: input.hasDevice ?? false,
    })
  ]
}

export function posterPalette(palette: string[] | null): PosterPalette {
  const brand = firstUsableColor(palette)
  const accent = brand ?? NEUTRAL_ACCENT
  return {
    accent,
    accentFromBrand: brand !== null,
    accentText: readableOn(accent),
    accentInk: legibleOn(PAPER, accent, INK),
    accentOnDark: legibleOn(DARK, accent, '#ffffff'),
    ink: INK,
    inkSoft: INK_SOFT,
    paper: PAPER,
    paperTint: brand ? mixHex(PAPER, accent, 0.07) : PAPER,
    dark: brand ? mixHex(DARK, accent, 0.12) : DARK,
  }
}

/**
 * The brand colour, moved along its own hue until it is readable on `ground`.
 *
 * Mixing toward black or white keeps the hue and drops the lightness that was
 * the actual problem, so a brand green stays green rather than becoming ink.
 * If even the fully-mixed colour cannot reach 4.5:1 — a hue too close to the
 * ground to survive at any lightness — we give up and use `fallback`, because
 * an unreadable headline is worse than an off-brand one.
 */
function legibleOn(ground: string, accent: string, fallback: string): string {
  if (contrastRatio(ground, accent) >= 4.5) return accent
  const toward = relativeLuminance(ground) > 0.4 ? '#000000' : '#ffffff'
  for (const amount of [0.2, 0.35, 0.5, 0.65, 0.8]) {
    const shifted = mixHex(accent, toward, amount)
    if (contrastRatio(ground, shifted) >= 4.5) return shifted
  }
  return fallback
}

/**
 * Display size for a headline: short lines run large, longer ones step
 * down so three lines still fit. Measured in 1080-wide poster pixels.
 */
export function headlineSizeFor(headline: string | null): number {
  const length = (headline ?? '').trim().length
  if (length <= 14) return 132
  if (length <= 24) return 112
  if (length <= 36) return 94
  if (length <= 48) return 78
  return 66
}

export function posterDesign(input: PosterInput): PosterDesign {
  const composition = compositionFor({
    direction: input.direction,
    composition: input.composition,
    hasImage: input.imageStoragePath !== null,
    hasDevice: input.deviceStoragePath !== null,
  })
  return {
    width: POSTER_WIDTH,
    height: posterHeight(input.format),
    margin: POSTER_MARGIN,
    layout: LAYOUT_FOR[composition],
    composition,
    anchor: ANCHOR_FOR[composition],
    accentTreatment: input.accentTreatment ?? ACCENT_FALLBACK[composition],
    ctaStyle: input.ctaStyle ?? CTA_FALLBACK[composition],
    palette: posterPalette(input.palette),
    headingFont: fontFamily(input.headingFont),
    bodyFont: fontFamily(input.bodyFont),
    headlineSize: headlineSizeFor(input.headline),
    supportingSize: 36,
    ctaSize: 32,
    eyebrowSize: 26,
  }
}

/** Only reached by pre-7G.1 creatives, which carry no art direction. */
const ACCENT_FALLBACK: Record<PosterComposition, PosterAccentTreatment> = {
  full_bleed: 'emphasis_word',
  hero_right: 'emphasis_word',
  hero_left: 'rule',
  center_hero: 'chip',
  editorial_split: 'rule',
  bottom_band: 'field',
  card_overlay: 'chip',
  device_beside: 'emphasis_word',
  device_hero: 'rule',
  device_stack: 'chip',
  typographic: 'emphasis_word',
}

const CTA_FALLBACK: Record<PosterComposition, PosterCtaStyle> = {
  full_bleed: 'solid',
  hero_right: 'solid',
  hero_left: 'outline',
  center_hero: 'chip',
  editorial_split: 'solid',
  bottom_band: 'bar',
  card_overlay: 'solid',
  device_beside: 'solid',
  device_hero: 'chip',
  device_stack: 'outline',
  typographic: 'solid',
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
