import type { CrawlResult } from './crawl'
import type { ExtractedPage } from './extract'

/**
 * Crawled pages → one compact, evidence-tagged corpus for the model.
 *
 * Two jobs, both about answer quality rather than cost alone:
 *
 *  1. Remove what repeats. Navigation and footers appear on every page; left
 *     in, they look to a model like the most important thing on the site.
 *  2. Keep provenance. Every block is labelled with the URL it came from, so
 *     the model can cite a source per field instead of guessing at one.
 */

/** Roughly 6k tokens of evidence. Ample for six small-business pages. */
const TOTAL_CHAR_BUDGET = 24_000

/** The homepage carries the identity, so it gets the largest share. */
const HOME_PAGE_SHARE = 0.35

/** A line on this many pages is chrome, not content. */
const BOILERPLATE_PAGE_RATIO = 0.6
const BOILERPLATE_MIN_PAGES = 3

const RELEVANT_LD_TYPES =
  /(Restaurant|FoodEstablishment|LocalBusiness|Organization|Store|Product|Offer|Menu|MenuItem|PostalAddress|OpeningHoursSpecification|Place)/i

export interface SiteSignals {
  emails: string[]
  phones: string[]
  socialLinks: string[]
  images: string[]
}

export interface NormalizedSite {
  startUrl: string
  pageUrls: string[]
  /** The text sent to the model. */
  corpus: string
  charCount: number
  signals: SiteSignals
}

export function normalizeSite(crawl: CrawlResult): NormalizedSite {
  const pages = crawl.pages
  const boilerplate = findBoilerplate(pages)

  const homeBudget = Math.floor(TOTAL_CHAR_BUDGET * HOME_PAGE_SHARE)
  const otherBudget =
    pages.length > 1 ? Math.floor((TOTAL_CHAR_BUDGET - homeBudget) / (pages.length - 1)) : 0

  const sections = pages.map((page, index) =>
    renderPage(page, index === 0 ? homeBudget : otherBudget, boilerplate),
  )

  const structured = renderStructuredData(pages)
  if (structured) sections.push(structured)

  const corpus = sections.join('\n\n').slice(0, TOTAL_CHAR_BUDGET + 4_000)

  return {
    startUrl: crawl.startUrl,
    pageUrls: pages.map((page) => page.url),
    corpus,
    charCount: corpus.length,
    signals: {
      emails: uniq(pages.flatMap((page) => page.emails)).slice(0, 10),
      phones: uniq(pages.flatMap((page) => page.phones)).slice(0, 10),
      socialLinks: uniq(pages.flatMap((page) => page.socialLinks)).slice(0, 15),
      images: uniq(pages.flatMap((page) => page.images)).slice(0, 20),
    },
  }
}

/** Lines that appear on most pages: menus bars, footers, cookie strips. */
export function findBoilerplate(pages: ExtractedPage[]): Set<string> {
  const repeated = new Set<string>()
  if (pages.length < BOILERPLATE_MIN_PAGES) return repeated

  const counts = new Map<string, number>()
  for (const page of pages) {
    for (const line of new Set(page.textBlocks)) {
      counts.set(line, (counts.get(line) ?? 0) + 1)
    }
  }

  const threshold = Math.max(BOILERPLATE_MIN_PAGES, Math.ceil(pages.length * BOILERPLATE_PAGE_RATIO))
  for (const [line, count] of counts) {
    if (count >= threshold) repeated.add(line)
  }

  return repeated
}

function renderPage(page: ExtractedPage, budget: number, boilerplate: Set<string>): string {
  const parts: string[] = [`### Page: ${page.url}`]

  if (page.title) parts.push(`Title: ${page.title}`)
  if (page.metaDescription) parts.push(`Description: ${page.metaDescription}`)
  if (page.headings.length > 0) {
    parts.push(`Headings: ${page.headings.slice(0, 25).join(' | ')}`)
  }

  // Price lines are the menu. They are never trimmed away first.
  if (page.priceLines.length > 0) {
    parts.push(`Items and prices:\n${page.priceLines.map((line) => `- ${line}`).join('\n')}`)
  }

  const body = page.textBlocks.filter((line) => !boilerplate.has(line))
  if (body.length > 0) {
    parts.push(`Text:\n${body.join('\n')}`)
  }

  const rendered = parts.join('\n')
  return rendered.length > budget ? `${rendered.slice(0, Math.max(budget, 400))}\n…[trimmed]` : rendered
}

/**
 * JSON-LD is the most trustworthy thing on most sites — it is the business
 * describing itself in a schema. Only relevant node types are kept, and the
 * payload is truncated, because some sites embed their entire catalogue.
 */
function renderStructuredData(pages: ExtractedPage[]): string | null {
  const nodes: string[] = []

  for (const page of pages) {
    for (const payload of page.structuredData) {
      const serialised = safeStringify(payload)
      if (!serialised) continue
      if (!RELEVANT_LD_TYPES.test(serialised)) continue
      nodes.push(`From ${page.url}:\n${serialised.slice(0, 2_000)}`)
      if (nodes.length >= 6) break
    }
    if (nodes.length >= 6) break
  }

  if (nodes.length === 0) return null
  return `### Structured data the site publishes about itself (JSON-LD)\n${nodes.join('\n')}`
}

function safeStringify(value: unknown): string | null {
  try {
    return JSON.stringify(value)
  } catch {
    return null
  }
}

function uniq(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))]
}
