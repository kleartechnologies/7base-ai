import { extractBrandVisual, type BrandVisual } from './brandVisual'
import { extractPage, type ExtractedPage } from './extract'
import { fetchPage, PageFetchError } from './fetchPage'
import { fetchRobots, isAllowedByRobots, type RobotsRules } from './robots'
import { isSameSite, normalizeWebsiteUrl } from './url'

/**
 * A deliberately small crawl.
 *
 * This is not a web crawler; it is "read a business's website the way a person
 * would before a first meeting". One page deep from the homepage, a handful of
 * pages, a hard time budget — enough to find the menu and the About page,
 * bounded enough that a hostile or enormous site cannot cost real money.
 */

export const CRAWL_LIMITS = {
  /** Homepage plus the most promising internal pages. */
  maxPages: 6,
  /** Only links found on the start page are followed. */
  maxDepth: 1,
  /** Whole-crawl wall clock, leaving room for the model call after it. */
  budgetMs: 45_000,
  /** Below this, there is not enough on the site to understand a business. */
  minTotalTextLength: 300,
} as const

/** Path and link-text signals that a page is worth reading, and how much. */
const LINK_SIGNALS: { pattern: RegExp; weight: number }[] = [
  { pattern: /\bmenu(s)?\b/i, weight: 10 },
  { pattern: /\b(product|products|shop|store|catalog(ue)?)\b/i, weight: 9 },
  { pattern: /\b(price|pricing|rates)\b/i, weight: 8 },
  { pattern: /\b(about|our[-\s]?story|who[-\s]?we[-\s]?are|profil)\b/i, weight: 8 },
  { pattern: /\b(service|services|catering|khidmat)\b/i, weight: 8 },
  { pattern: /\b(promo|promotion|offer|deal|special)\b/i, weight: 7 },
  { pattern: /\b(contact|hubungi|reach[-\s]?us)\b/i, weight: 7 },
  { pattern: /\b(location|outlet|branch|find[-\s]?us|cawangan)\b/i, weight: 6 },
  { pattern: /\b(food|dish|cuisine|makanan)\b/i, weight: 6 },
  { pattern: /\b(order|delivery|reservation|booking|tempah)\b/i, weight: 5 },
  { pattern: /\b(faq|questions)\b/i, weight: 4 },
  { pattern: /\b(gallery|photos)\b/i, weight: 3 },
]

/** Pages that exist on every site and tell MARKA nothing about the business. */
const LINK_EXCLUSIONS =
  /\b(login|signin|sign-in|register|signup|account|cart|checkout|basket|privacy|terms|policy|refund|shipping|wp-admin|wp-login|feed|rss|sitemap|tag|author|search)\b/i

/** Extensions that are not HTML. Filtered before a request is ever made. */
const NON_PAGE_EXTENSION =
  /\.(pdf|jpe?g|png|gif|webp|avif|svg|ico|css|js|mjs|json|xml|zip|rar|gz|mp4|mp3|mov|avi|doc|docx|xls|xlsx|ppt|pptx)(\?|$)/i

export type CrawlStage = 'fetching' | 'reading_pages'

export interface CrawlOptions {
  /** Reports real progress as pages come in. Never called with a fake step. */
  onProgress?: (stage: CrawlStage, pagesRead: number) => void
}

export interface CrawlFailure {
  url: string
  reason: string
}

export interface CrawlResult {
  startUrl: string
  pages: ExtractedPage[]
  failures: CrawlFailure[]
  totalTextLength: number
  /**
   * Deterministic brand visuals read off the homepage HTML that was already
   * fetched for the crawl — no extra request is ever made for them.
   */
  brandVisual: BrandVisual
}

export class SiteUnreachableError extends Error {
  constructor(readonly url: string, readonly reason: string) {
    super(`Could not read ${url}: ${reason}`)
    this.name = 'SiteUnreachableError'
  }
}

export async function crawlSite(rawUrl: string, options: CrawlOptions = {}): Promise<CrawlResult> {
  const startUrl = normalizeWebsiteUrl(rawUrl)
  const deadline = Date.now() + CRAWL_LIMITS.budgetMs
  const failures: CrawlFailure[] = []

  options.onProgress?.('fetching', 0)

  const robots = await fetchRobots(startUrl)

  // The homepage is not optional: if it cannot be read, there is no analysis.
  let root: ExtractedPage
  let rootUrl: string
  let brandVisual: BrandVisual
  try {
    const fetched = await fetchPage(startUrl)
    rootUrl = fetched.url
    root = extractPage(fetched.url, fetched.html)
    brandVisual = extractBrandVisual(fetched.url, fetched.html)
  } catch (error) {
    throw new SiteUnreachableError(
      startUrl,
      error instanceof PageFetchError ? error.failure : 'unreachable',
    )
  }

  const pages: ExtractedPage[] = [root]
  const visited = new Set([canonicalKey(rootUrl), canonicalKey(startUrl)])

  options.onProgress?.('reading_pages', pages.length)

  for (const candidate of rankInternalLinks(rootUrl, root, robots)) {
    if (pages.length >= CRAWL_LIMITS.maxPages) break
    if (Date.now() > deadline) break

    const key = canonicalKey(candidate)
    if (visited.has(key)) continue
    visited.add(key)

    try {
      const fetched = await fetchPage(candidate)
      const page = extractPage(fetched.url, fetched.html)
      // A page can redirect onto one already read. The candidate's own key was
      // added above, so only a *different* key that is already visited means a
      // genuine duplicate — comparing against the candidate itself would drop
      // every trailing-slash and index-file redirect, which is most of them.
      const finalKey = canonicalKey(fetched.url)
      if (finalKey !== key && visited.has(finalKey)) continue
      visited.add(finalKey)

      pages.push(page)
      options.onProgress?.('reading_pages', pages.length)
    } catch (error) {
      failures.push({
        url: candidate,
        reason: error instanceof PageFetchError ? error.failure : 'unreachable',
      })
    }
  }

  return {
    startUrl: rootUrl,
    pages,
    failures,
    totalTextLength: pages.reduce((total, page) => total + page.textLength, 0),
    brandVisual,
  }
}

/**
 * Orders the homepage's internal links by how likely they are to describe the
 * business. Scoring beats breadth: six well-chosen pages tell a model more
 * than thirty arbitrary ones.
 */
export function rankInternalLinks(
  baseUrl: string,
  page: ExtractedPage,
  robots: RobotsRules = { disallowed: [] },
): string[] {
  const scored = new Map<string, number>()

  for (const link of page.links) {
    if (!isSameSite(baseUrl, link.url)) continue
    if (NON_PAGE_EXTENSION.test(link.url)) continue

    let parsed: URL
    try {
      parsed = new URL(link.url)
    } catch {
      continue
    }

    // Depth 1: at most a couple of path segments below the root.
    const segments = parsed.pathname.split('/').filter(Boolean)
    if (segments.length === 0) continue
    if (segments.length > 3) continue

    const haystack = `${decodeURIComponent(parsed.pathname)} ${parsed.search} ${link.text}`
    if (LINK_EXCLUSIONS.test(haystack)) continue
    if (!isAllowedByRobots(robots, link.url)) continue

    let score = 0
    for (const signal of LINK_SIGNALS) {
      if (signal.pattern.test(haystack)) score += signal.weight
    }
    if (score === 0) continue

    // Shallower pages are usually the canonical ones.
    score += Math.max(0, 3 - segments.length)
    // A query string usually means a filtered view of a page we already have.
    if (parsed.search) score -= 4

    const key = canonicalKey(link.url)
    scored.set(key, Math.max(scored.get(key) ?? 0, score))
  }

  return [...scored.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, CRAWL_LIMITS.maxPages * 2)
    .map(([url]) => url)
}

/** Ignores trailing slashes and index files when deciding "already seen". */
function canonicalKey(url: string): string {
  try {
    const parsed = new URL(url)
    parsed.hash = ''
    const path = parsed.pathname.replace(/\/(index\.\w+)?$/, '') || '/'
    return `${parsed.protocol}//${parsed.hostname}${path}${parsed.search}`
  } catch {
    return url
  }
}
