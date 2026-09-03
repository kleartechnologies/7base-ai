/** Small conversions shared by the Business Brain editors. */

/** Lists are edited as one-item-per-line text: no chip widget to learn. */
export function toLines(items: string[] | null | undefined): string {
  return (items ?? []).join('\n')
}

export function fromLines(text: string): string[] {
  const seen = new Set<string>()
  const items: string[] = []
  for (const line of text.split('\n')) {
    const clean = line.trim()
    if (!clean) continue
    const key = clean.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    items.push(clean)
  }
  return items
}

export function trimmedOrNull(value: string): string | null {
  const clean = value.trim()
  return clean.length > 0 ? clean : null
}

/** Prices are stored in sen and edited in ringgit. */
export function toMajorUnits(minor: number | null): string {
  return minor === null ? '' : (minor / 100).toFixed(2)
}

export function fromMajorUnits(value: string): number | null {
  const clean = value.trim().replace(/[^0-9.]/g, '')
  if (!clean) return null
  const parsed = Number.parseFloat(clean)
  if (!Number.isFinite(parsed) || parsed < 0) return null
  return Math.round(parsed * 100)
}

export function formatPrice(minor: number | null, currency: string): string | null {
  if (minor === null) return null
  const symbol = currency === 'MYR' ? 'RM' : `${currency} `
  return `${symbol}${(minor / 100).toFixed(2)}`
}
