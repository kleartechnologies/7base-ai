import type { Discovered, Product, StoredBusiness } from '../lib/business.types'
import { readBrandKit } from '../creative/brand'

/**
 * Turns a stored Business Brain into prompt context.
 *
 * Two rules govern what goes in:
 *
 *  1. Only known facts. Empty fields are omitted rather than sent as
 *     "unknown", which would otherwise teach the model to fill gaps by
 *     guessing.
 *  2. Inference stays labelled. A section MARKA inferred from the website and
 *     one the owner confirmed are both useful, but they are not the same kind
 *     of claim, and the model must not present the first as the second.
 */

const MAX_PRODUCTS = 25
const MAX_LIST_ITEMS = 8

/** One level of nesting under a provenance header. */
const SECTION_INDENT = '  '

export function buildBusinessContext(business: StoredBusiness | null): string | null {
  if (!business) return null

  const lines: string[] = []

  /**
   * Writes `- Label: value` at a given depth.
   *
   * The indent is the whole point of this indirection. A provenance header
   * followed by fields at the *same* depth reads as two unrelated statements,
   * and the label ends up governing nothing — which is how an inference
   * quietly becomes a fact.
   */
  const writerAt = (indent: string) => ({
    push: (label: string, value: unknown) => {
      if (typeof value === 'string' && value.trim()) lines.push(`${indent}- ${label}: ${value.trim()}`)
    },
    pushList: (label: string, values: unknown) => {
      if (!Array.isArray(values)) return
      const items = values.filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
      if (items.length > 0) {
        lines.push(`${indent}- ${label}: ${items.slice(0, MAX_LIST_ITEMS).join(', ')}`)
      }
    },
  })

  const { push } = writerAt('')

  lines.push(
    'ESTABLISHED FACTS — read from their website or confirmed by the owner. You may state these directly.',
  )

  push('Name', business.name)
  push('Type', business.identity?.businessType)
  push('Cuisine or niche', business.identity?.subIndustry)
  push('Category', business.identity?.category)
  push('Description', business.identity?.description)
  push('Tagline', business.identity?.tagline)

  const location = [business.location?.city, business.location?.state]
    .filter((part): part is string => Boolean(part))
    .join(', ')
  push('Location', location)
  push('Service area', business.location?.serviceArea)
  push('Opening hours', business.location?.openingHours)
  push('Website', business.contact?.website)
  push('Phone', business.contact?.phone)

  const socials = business.contact?.socialProfiles
  if (Array.isArray(socials) && socials.length > 0) {
    lines.push(`- Social: ${socials.map((s) => `${s.platform} ${s.url}`).join(', ')}`)
  }

  const products = Array.isArray(business.products) ? business.products : []
  if (products.length > 0) {
    lines.push(`- Menu / products (${products.length} known):`)
    for (const product of products.slice(0, MAX_PRODUCTS)) {
      lines.push(`  • ${describeProduct(product)}`)
    }
    if (products.length > MAX_PRODUCTS) {
      lines.push(`  • …and ${products.length - MAX_PRODUCTS} more`)
    }
  }

  const nested = writerAt(SECTION_INDENT)

  section(lines, 'AUDIENCE', business.audience, (audience) => {
    nested.push('Audience summary', audience.summary)
    nested.pushList('Customer types', audience.customerTypes)
    nested.pushList('Their needs', audience.needs)
    nested.pushList('Occasions', audience.useCases)
  })

  section(lines, 'BRAND', business.brand, (brand) => {
    nested.push('Brand voice', brand.voice)
    nested.pushList('Personality', brand.personalityTraits)
    nested.push('Visual style', brand.visualStyle)
    nested.pushList('Key messages', brand.keyMessages)
  })

  // Brand Identity is owner-set by construction (only the owner can write
  // it), so it carries the strongest provenance label without a wrapper.
  const brandKit = readBrandKit(business)
  if (
    brandKit &&
    (brandKit.logoAssetId ||
      brandKit.colors.primary ||
      brandKit.typography.heading ||
      brandKit.styleTraits.length > 0 ||
      brandKit.notes)
  ) {
    lines.push('')
    lines.push(
      'BRAND IDENTITY — SET BY THE OWNER. This is their approved visual identity; keep creatives on-brand with it by default. If they ask for something that clearly conflicts, keep the brand unless they confirm a one-off exception.',
    )
    if (brandKit.logoAssetId) {
      lines.push(`${SECTION_INDENT}- Official logo: set (used on their creatives automatically)`)
    }
    const colours = [
      brandKit.colors.primary && `primary ${brandKit.colors.primary}`,
      brandKit.colors.secondary && `secondary ${brandKit.colors.secondary}`,
      brandKit.colors.accent && `accent ${brandKit.colors.accent}`,
    ].filter(Boolean)
    if (colours.length > 0) lines.push(`${SECTION_INDENT}- Brand colours: ${colours.join(', ')}`)
    const fonts = [
      brandKit.typography.heading && `headings ${brandKit.typography.heading}`,
      brandKit.typography.body && `body ${brandKit.typography.body}`,
    ].filter(Boolean)
    if (fonts.length > 0) lines.push(`${SECTION_INDENT}- Typography: ${fonts.join(', ')}`)
    nested.pushList('Style', brandKit.styleTraits)
    nested.push('Style notes', brandKit.styleNotes)
    nested.push('Brand notes', brandKit.notes)
  }

  section(lines, 'MARKETING', business.marketing, (marketing) => {
    nested.push('Positioning', marketing.positioning)
    nested.push('Value proposition', marketing.valueProposition)
    nested.pushList('What sets them apart', marketing.differentiators)
    nested.pushList('Current promotions', marketing.promotions)
    nested.pushList('Channels already used', marketing.activeChannels)
  })

  section(lines, 'OPERATIONS', business.operations, (operations) => {
    nested.pushList('Ordering methods', operations.orderingMethods)
    nested.pushList('Delivery platforms', operations.deliveryPlatforms)
    nested.push('Reservations', operations.reservations)
  })

  const unknowns = business.discovery?.unknowns
  if (Array.isArray(unknowns) && unknowns.length > 0) {
    lines.push('')
    lines.push('NOT KNOWN — the website did not establish these. Ask; never guess.')
    for (const unknown of unknowns.slice(0, MAX_LIST_ITEMS)) {
      lines.push(`${SECTION_INDENT}- ${unknown}`)
    }
  }

  return lines.length > 0 ? lines.join('\n') : null
}

/**
 * Emits a section under an explicit provenance header, with its fields
 * indented beneath it.
 *
 * The label is the whole point: "confirmed by the owner" and "MARKA's reading
 * of the website" must not look identical to the model. Indentation is what
 * binds the label to the fields it governs — without it the header is just
 * another line, and the distinction it carries is lost.
 */
function section<T>(
  lines: string[],
  label: string,
  discovered: Discovered<T> | null | undefined,
  render: (value: T) => void,
): void {
  if (!discovered?.value) return

  const provenance = discovered.confirmed
    ? 'CONFIRMED BY THE OWNER. Treat as fact.'
    : discovered.source === 'inferred'
      ? `EVA'S INFERENCE from their website, not confirmed. Treat as a working assumption and offer it as one.`
      : 'READ FROM THEIR WEBSITE, not confirmed by the owner.'

  lines.push('')
  lines.push(`${label} — ${provenance}`)
  render(discovered.value)
}

function describeProduct(product: Product): string {
  const parts = [product.name]
  if (typeof product.priceMinor === 'number') {
    parts.push(`${product.currency || 'MYR'} ${(product.priceMinor / 100).toFixed(2)}`)
  }
  if (product.category) parts.push(`(${product.category})`)
  if (product.isSignature) parts.push('— highlighted on their site')
  return parts.join(' ')
}
