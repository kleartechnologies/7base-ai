import type { CreativeStyle } from '@/types'

/**
 * The poster's geometry and palette, as pure data.
 *
 * The creative stays structured — headline, offer and CTA are fields, and the
 * image deliberately contains no text — so the poster is *composed* at render
 * time: this spec decides where and how, and the canvas renderer merely
 * executes it. Keeping the decisions here, DOM-free, is what makes them
 * testable and keeps the preview (CSS) and the download (canvas) visually
 * consistent.
 */

export interface PosterSpec {
  /** Export pixels: 1080-wide social sizes, not screenshots. */
  width: number
  height: number
  /** Brand accent for the CTA pill and offer badge. */
  accent: string
  /** Text color that stays readable on the accent. */
  accentText: string
  /** Outer margin all text respects. */
  margin: number
  headlineSize: number
  subheadlineSize: number
  offerSize: number
  ctaSize: number
  headingFont: string
  bodyFont: string
  /** Fraction of the height the bottom scrim gradient covers. */
  scrimFraction: number
}

const FALLBACK_ACCENT = '#C2410C'
const HEADING_STACK = "-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"

export function posterSpec(
  format: 'square_post' | 'portrait_post',
  style: CreativeStyle | null,
): PosterSpec {
  const accent = firstUsableColor(style?.palette ?? null) ?? FALLBACK_ACCENT
  return {
    width: 1080,
    height: format === 'portrait_post' ? 1350 : 1080,
    accent,
    accentText: readableTextOn(accent),
    margin: 72,
    headlineSize: 84,
    subheadlineSize: 40,
    offerSize: 34,
    ctaSize: 34,
    headingFont: style?.headingFont
      ? `'${style.headingFont}', ${HEADING_STACK}`
      : HEADING_STACK,
    bodyFont: HEADING_STACK,
    scrimFraction: 0.55,
  }
}

/** The first palette entry that parses as a hex color. */
export function firstUsableColor(palette: string[] | null): string | null {
  for (const entry of palette ?? []) {
    const hex = normalizeHex(entry)
    if (hex) return hex
  }
  return null
}

export function normalizeHex(value: string): string | null {
  const clean = value.trim()
  if (/^#[0-9a-f]{6}$/i.test(clean)) return clean.toLowerCase()
  if (/^#[0-9a-f]{3}$/i.test(clean)) {
    const [r, g, b] = clean.slice(1)
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase()
  }
  return null
}

/** Black or white, whichever is readable on the given hex background. */
export function readableTextOn(hex: string): '#ffffff' | '#1a1a1a' {
  const normalized = normalizeHex(hex)
  if (!normalized) return '#ffffff'
  const r = parseInt(normalized.slice(1, 3), 16)
  const g = parseInt(normalized.slice(3, 5), 16)
  const b = parseInt(normalized.slice(5, 7), 16)
  // Relative luminance, the WCAG-ish quick form.
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b
  return luminance > 160 ? '#1a1a1a' : '#ffffff'
}

/** "Weekday Lunch Poster" → "weekday-lunch-poster-square.png". */
export function posterFileName(name: string, format: 'square_post' | 'portrait_post'): string {
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'poster'
  return `${slug}-${format === 'portrait_post' ? 'portrait' : 'square'}.png`
}

/**
 * Greedy word wrap against a measured line width. The measurer is injected so
 * the logic stays pure — canvas passes `ctx.measureText`, tests pass a stub.
 */
export function wrapLines(
  text: string,
  maxWidth: number,
  measure: (candidate: string) => number,
  maxLines = 3,
): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    if (current && measure(candidate) > maxWidth) {
      lines.push(current)
      current = word
      if (lines.length === maxLines) return lines
    } else {
      current = candidate
    }
  }
  if (current && lines.length < maxLines) lines.push(current)
  return lines
}
