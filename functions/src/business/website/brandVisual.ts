import { BRAND_FONTS, type BrandColor, type BrandFont } from '../../lib/business.types'

/**
 * Deterministic brand visuals, read off the homepage HTML the crawler has
 * ALREADY fetched (Phase 7D.1). No extra request, no crawling, no AI — pure
 * string work over one document, the same discipline as `extract.ts`.
 *
 * Everything found here is a CANDIDATE. It flows into the discovered `brand`
 * section (provenance-wrapped, unconfirmed) and is only ever applied to the
 * owner's Brand Kit through the explicit "Use these" confirmation in Brand
 * Identity. Weak evidence returns nothing: a missing colour is more honest
 * than a guessed one.
 */

export interface BrandVisual {
  /** At most three brand-like colours, normalised to lowercase #rrggbb. */
  colors: BrandColor[]
  /** Icon/logo candidate URL. A candidate only — never auto-applied. */
  logoUrl: string | null
  /** A font named in the HTML, only when it maps onto the approved list. */
  fontFamily: BrandFont | null
}

export function hasBrandVisual(visual: BrandVisual | null | undefined): boolean {
  return Boolean(visual && (visual.colors.length > 0 || visual.logoUrl || visual.fontFamily))
}

const MAX_COLORS = 3

export function extractBrandVisual(url: string, html: string): BrandVisual {
  return {
    colors: extractColors(html),
    logoUrl: extractLogoCandidate(url, html),
    fontFamily: extractFontCandidate(html),
  }
}

/* --- logo candidate ----------------------------------------------------- */

/**
 * Priority: apple-touch-icon → `rel="icon"` → `rel="shortcut icon"` →
 * `og:image`. Touch icons are the strongest signal a site gives about its own
 * mark (they exist to represent the brand on a home screen); og:image is a
 * social preview and often a photo, so it is only the last resort. Within a
 * tier, a bigger declared size wins — a 16px favicon makes a poor logo.
 */
function extractLogoCandidate(baseUrl: string, html: string): string | null {
  const candidates: { href: string; tier: number; size: number }[] = []

  for (const tag of collectTags(html, 'link')) {
    const rel = (attr(tag, 'rel') ?? '').toLowerCase()
    if (!rel.includes('icon')) continue
    const href = attr(tag, 'href')
    if (!href) continue

    const tier = rel.includes('apple-touch-icon') ? 3 : rel.includes('shortcut') ? 1 : 2
    candidates.push({ href, tier, size: declaredSize(tag, href) })
  }

  candidates.sort((a, b) => b.tier - a.tier || b.size - a.size)
  for (const candidate of candidates) {
    const resolved = resolveHttpUrl(baseUrl, candidate.href)
    if (resolved) return resolved
  }

  const og = metaContent(html, 'property', 'og:image')
  return og ? resolveHttpUrl(baseUrl, og) : null
}

function declaredSize(tag: string, href: string): number {
  // An SVG scales; rank it above every fixed-size bitmap.
  if (/\.svg(\?|$)/i.test(href)) return 1024
  const sizes = attr(tag, 'sizes')
  if (!sizes) return 0
  let largest = 0
  for (const match of sizes.matchAll(/(\d+)x\d+/gi)) {
    largest = Math.max(largest, Number(match[1]))
  }
  return largest
}

/* --- colours ------------------------------------------------------------ */

/**
 * Custom-property names that carry brand intent. Deliberately narrow: this
 * reads a handful of explicit declarations, it is not a CSS parser.
 */
const BRAND_VARIABLE = /--([a-z0-9-]*(?:brand|primary|accent|secondary)[a-z0-9-]*)\s*:\s*([^;}]+)/gi

/** Variable names that are UI plumbing rather than brand colour. */
const VARIABLE_EXCLUSIONS =
  /(background|foreground|border|shadow|hover|muted|text|gray|grey|white|black|light|dark|font|size|width|radius|spacing)/i

function extractColors(html: string): BrandColor[] {
  const colors: BrandColor[] = []
  const seen = new Set<string>()

  const push = (label: string, raw: string | null | undefined) => {
    if (!raw || colors.length >= MAX_COLORS) return
    const hex = normalizeCssColor(raw.trim())
    if (!hex || !isBrandLike(hex) || seen.has(hex)) return
    seen.add(hex)
    colors.push({ label, hex })
  }

  // The strongest deterministic signal a page gives: the colour it asks the
  // browser chrome to wear.
  for (const tag of collectTags(html, 'meta')) {
    const name = (attr(tag, 'name') ?? '').toLowerCase()
    if (name === 'theme-color') push('Theme color', attr(tag, 'content'))
  }
  push('Tile color', metaContent(html, 'name', 'msapplication-TileColor'))

  // Explicit brand declarations in CSS already inlined in the document.
  for (const block of styleBlocks(html)) {
    for (const match of block.matchAll(BRAND_VARIABLE)) {
      const name = match[1] ?? ''
      if (VARIABLE_EXCLUSIONS.test(name)) continue
      push(`--${name}`, match[2])
    }
  }

  return colors
}

/**
 * #RGB, #RRGGBB, rgb(...) and rgba(...) → lowercase #rrggbb, or null. An
 * rgba() that is mostly transparent is not a usable brand swatch.
 */
export function normalizeCssColor(input: string): string | null {
  const raw = input.trim()

  const hex6 = /^#([0-9a-f]{6})$/i.exec(raw)
  if (hex6?.[1]) return `#${hex6[1].toLowerCase()}`

  const hex3 = /^#([0-9a-f]{3})$/i.exec(raw)
  if (hex3?.[1]) {
    const [r, g, b] = hex3[1].toLowerCase()
    return `#${r}${r}${g}${g}${b}${b}`
  }

  const rgb = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(
    raw,
  )
  if (rgb) {
    const [r, g, b] = [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])]
    if (r > 255 || g > 255 || b > 255) return null
    if (rgb[4] !== undefined && Number(rgb[4]) < 0.5) return null
    return `#${toByte(r)}${toByte(g)}${toByte(b)}`
  }

  return null
}

function toByte(value: number): string {
  return value.toString(16).padStart(2, '0')
}

/**
 * Filters out colours that are page plumbing rather than brand: near-white
 * grounds, near-black text, and neutral greys. Rejecting a real (very dark or
 * grey) brand colour occasionally is the accepted cost — the owner can always
 * set it by hand; a wall of #ffffff suggestions helps nobody.
 */
export function isBrandLike(hex: string): boolean {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  if (r >= 0xf0 && g >= 0xf0 && b >= 0xf0) return false
  if (r <= 0x18 && g <= 0x18 && b <= 0x18) return false
  if (Math.max(r, g, b) - Math.min(r, g, b) <= 0x10) return false
  return true
}

/* --- font --------------------------------------------------------------- */

/**
 * A font counts only when the page names it outright — a Google Fonts link
 * (the family is spelled in the URL; nothing is fetched) or a `font-family`
 * declaration in inline CSS — AND it maps exactly onto the approved Brand Kit
 * list. Anything else stays null rather than being forced into the enum.
 */
function extractFontCandidate(html: string): BrandFont | null {
  const candidates: string[] = []

  for (const tag of collectTags(html, 'link')) {
    const href = attr(tag, 'href') ?? ''
    const query = /fonts\.googleapis\.com\/css2?\?([^"'\s>]+)/i.exec(href)?.[1]
    if (!query) continue
    for (const part of query.split('&')) {
      const family = /^family=([^:&]+)/i.exec(part)?.[1]
      if (family) candidates.push(safeDecode(family).replace(/\+/g, ' '))
    }
  }

  for (const block of styleBlocks(html)) {
    for (const match of block.matchAll(/font-family\s*:\s*([^;}]+)/gi)) {
      for (const name of (match[1] ?? '').split(',')) {
        candidates.push(name.replace(/["']/g, '').trim())
      }
    }
  }

  for (const candidate of candidates) {
    const cleaned = candidate.trim().toLowerCase()
    const approved = BRAND_FONTS.find((font) => font.toLowerCase() === cleaned)
    if (approved) return approved
  }
  return null
}

/* --- small HTML helpers (no DOM, no parser dependency) ------------------ */

function collectTags(html: string, tag: string): string[] {
  const results: string[] = []
  const pattern = new RegExp(`<${tag}\\b[^>]*>`, 'gi')
  let match: RegExpExecArray | null
  while ((match = pattern.exec(html)) !== null) {
    results.push(match[0])
    if (results.length > 200) break
  }
  return results
}

function attr(tag: string, name: string): string | null {
  const pattern = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i')
  const match = pattern.exec(tag)
  const value = (match?.[1] ?? match?.[2] ?? '').trim()
  return value || null
}

function metaContent(html: string, attribute: string, name: string): string | null {
  for (const tag of collectTags(html, 'meta')) {
    if ((attr(tag, attribute) ?? '').toLowerCase() !== name.toLowerCase()) continue
    const content = attr(tag, 'content')
    if (content) return content
  }
  return null
}

function styleBlocks(html: string): string[] {
  const blocks: string[] = []
  const pattern = /<style\b[^>]*>([\s\S]*?)<\/style>/gi
  let match: RegExpExecArray | null
  while ((match = pattern.exec(html)) !== null) {
    if (match[1]) blocks.push(match[1])
    if (blocks.length > 20) break
  }
  return blocks
}

/**
 * Same discipline as `extract.ts`'s resolve: scheme-filtered, resolved against
 * the page that was actually fetched. `data:`/`javascript:` never pass; only
 * http(s) URLs come out. The URL is stored, not fetched — any later fetch of
 * it goes through the existing guarded paths.
 */
function resolveHttpUrl(baseUrl: string, href: string): string | null {
  if (/^(javascript|data|vbscript|file|blob):/i.test(href)) return null
  try {
    const url = new URL(href, baseUrl)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    url.hash = ''
    return url.toString()
  } catch {
    return null
  }
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}
