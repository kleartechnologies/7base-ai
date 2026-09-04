import type { ExtractedPage } from '../website/extract'
import type { DiscoverySourceKind } from './source'

/**
 * What a fetched Facebook Page or Instagram profile actually gave us.
 *
 * Both platforms decide per-request whether an anonymous server gets the
 * public page or a login wall, and neither documents the rules. So this
 * module never assumes success: it inspects what came back, says honestly
 * whether it is business information or a wall, and builds a corpus only
 * from what is genuinely there. Pure functions — the fetch itself stays in
 * fetchPage with its SSRF guarantees.
 */

/**
 * Below this much readable text a social page is a shell — a login wall that
 * slipped past the title checks, or a script-only render with empty HTML.
 * Far lower than the website crawl's 300-char floor because a bio plus a
 * category line is genuinely enough to start a conversation from.
 */
export const MIN_SOCIAL_TEXT_LENGTH = 80

/** Paths both platforms redirect anonymous visitors to. */
const LOGIN_PATHS = ['/login', '/login.php', '/login/', '/accounts/login', '/checkpoint']

/** Titles a login wall or an empty shell serves. Matched whole, lowercased. */
const WALL_TITLES = new Set([
  'facebook',
  'facebook - log in or sign up',
  'log in to facebook',
  'log into facebook',
  'instagram',
  'login • instagram',
  'log in • instagram',
  'page not found',
  'content not found',
  "this content isn't available right now",
])

const WALL_TITLE_PATTERNS = [/^log\s?in\b/i, /\blog in or sign up\b/i, /\bsign up\b.*\bfacebook\b/i]

/**
 * True when what came back is a login wall or an unavailable-content shell
 * rather than the public page. `finalUrl` is the URL after redirects — a hop
 * to /login is the clearest signal either platform gives.
 */
export function isSocialLoginWall(
  kind: DiscoverySourceKind,
  finalUrl: string,
  page: Pick<ExtractedPage, 'title' | 'textLength'>,
): boolean {
  if (kind === 'website') return false

  try {
    const path = new URL(finalUrl).pathname.toLowerCase()
    if (LOGIN_PATHS.some((p) => path === p || path.startsWith(`${p}/`) || path.startsWith(`${p}?`))) {
      return true
    }
  } catch {
    // An unparseable final URL proves nothing either way; fall through.
  }

  const title = (page.title ?? '').trim().toLowerCase()
  if (title && WALL_TITLES.has(title)) return true
  if (title && WALL_TITLE_PATTERNS.some((p) => p.test(title))) return true

  // No title and nothing to read: a script-shell render, indistinguishable
  // from a wall for our purposes.
  if (!title && page.textLength < MIN_SOCIAL_TEXT_LENGTH) return true

  return false
}

export interface SocialCorpus {
  corpus: string
  /** Characters of actual page-derived text — drives the "enough?" check. */
  textLength: number
  signals: {
    emails: string[]
    phones: string[]
    outboundLinks: string[]
  }
}

const MAX_CORPUS_CHARS = 8_000

/**
 * Flattens a social page into the corpus the analysis prompt reads.
 *
 * A profile is one page, not a site: title, bio (meta/og description),
 * headings, visible text and any JSON-LD the platform embeds. Everything is
 * labelled so the model knows it is reading a profile, and nothing is padded
 * — if the platform gave three lines, the model gets three lines and the
 * prompt's "leave unknowns null" discipline does the rest.
 */
export function buildSocialCorpus(kind: DiscoverySourceKind, page: ExtractedPage): SocialCorpus {
  const platform = kind === 'instagram' ? 'Instagram profile' : 'Facebook Page'
  const lines: string[] = []
  let textLength = 0

  const add = (label: string, value: string | null | undefined) => {
    const text = value?.trim()
    if (!text) return
    lines.push(label ? `${label}: ${text}` : text)
    textLength += text.length
  }

  add(`${platform} title`, page.title)
  add('Profile description', page.metaDescription)

  for (const heading of page.headings) add('', heading)
  for (const block of page.textBlocks) add('', block)
  for (const price of page.priceLines) add('Price line', price)

  for (const data of page.structuredData) {
    try {
      const json = JSON.stringify(data)
      if (json && json !== '{}' && json !== 'null') {
        lines.push(`Structured data: ${json}`)
        textLength += Math.min(json.length, 500)
      }
    } catch {
      // Circular or unserialisable JSON-LD: skip, never fail the run.
    }
  }

  const corpus = dedupe(lines).join('\n').slice(0, MAX_CORPUS_CHARS)

  return {
    corpus,
    textLength,
    signals: {
      emails: page.emails,
      phones: page.phones,
      // A website linked from the profile is a lead the owner can follow up
      // on manually; discovery itself only ever fetches the URL it was given.
      outboundLinks: page.links
        .map((link) => link.url)
        .filter((url) => isOutbound(url))
        .slice(0, 10),
    },
  }
}

function dedupe(lines: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const line of lines) {
    const key = line.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(line)
  }
  return result
}

const PLATFORM_HOST = /(^|\.)((facebook|instagram|fb|fbcdn|cdninstagram)\.(com|net))$/

function isOutbound(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase()
    return !PLATFORM_HOST.test(host)
  } catch {
    return false
  }
}
