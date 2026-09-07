/**
 * The small, pure text and colour helpers the poster pipeline is built from.
 *
 * The layout itself lives in `posterDesign.ts` (what the poster is) and
 * `posterDraw.ts` (how it is painted). What used to live here was a second,
 * older spec — its own geometry, its own fallback accent — and while it
 * existed a surface could quietly compose a poster from it instead of from
 * the creative: that is exactly how the same creative came out orange in the
 * chat and green in the library (§21). It is gone; only these helpers remain,
 * and they decide nothing on their own.
 */

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
 *
 * Note the contract at the line limit: text that does not fit is *dropped*,
 * not shrunk, because only the caller knows whether it can afford another
 * line or a smaller size. Callers that must print every word — the renderer
 * does — have to compare what came back against what they passed in.
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
