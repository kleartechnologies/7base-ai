/**
 * HTML → structured page content.
 *
 * Pure string work: no DOM, no parser dependency, no page scripts ever run.
 * The output is what a person would read off the page, plus the few machine
 * signals worth keeping (JSON-LD, Open Graph, mailto/tel links).
 *
 * This is where the volume reduction happens. A restaurant homepage is often
 * 300 KB of markup and 2 KB of information; sending the markup to a model
 * would be slow, expensive and *worse*, because boilerplate crowds out the
 * menu.
 */

export interface ExtractedLink {
  url: string
  text: string
}

export interface ExtractedPage {
  url: string
  title: string | null
  /**
   * Open Graph title, kept separately from `<title>`. On script-shell pages
   * (social platforms especially) the OG tags are sometimes the only place
   * the page names its subject.
   */
  ogTitle: string | null
  metaDescription: string | null
  headings: string[]
  /** Readable prose and list items, in document order, de-duplicated. */
  textBlocks: string[]
  /** Lines that mention a price. Kept separately because menus live in them. */
  priceLines: string[]
  links: ExtractedLink[]
  images: string[]
  emails: string[]
  phones: string[]
  socialLinks: string[]
  /** Parsed `application/ld+json` payloads, unvalidated. */
  structuredData: unknown[]
  /** Total characters of readable text. Drives the "enough content?" check. */
  textLength: number
}

/** Elements whose contents are never page copy. */
const NON_CONTENT_TAGS = [
  'script',
  'style',
  'noscript',
  'svg',
  'iframe',
  'template',
  'canvas',
  'object',
  'video',
  'audio',
]

/** Phrases that mark a line as chrome rather than content. */
const BOILERPLATE_PATTERNS = [
  /\bcookie(s)?\b.*\b(accept|consent|policy|settings|preferences)\b/i,
  /\baccept all\b/i,
  /\bwe use cookies\b/i,
  /\bskip to (main )?content\b/i,
  /\ball rights reserved\b/i,
  /\bprivacy policy\b\s*[|·•-]?\s*\bterms\b/i,
  /\bpowered by\b/i,
  /^\s*(menu|close|open|search|toggle navigation|back to top)\s*$/i,
]

const SOCIAL_HOSTS = [
  'facebook.com',
  'fb.com',
  'instagram.com',
  'tiktok.com',
  'twitter.com',
  'x.com',
  'youtube.com',
  'wa.me',
  'api.whatsapp.com',
  'linkedin.com',
]

const MAX_HEADINGS = 60
const MAX_TEXT_BLOCKS = 220
const MAX_PRICE_LINES = 120
const MAX_LINKS = 250
const MAX_IMAGES = 25

export function extractPage(url: string, html: string): ExtractedPage {
  // JSON-LD lives inside <script>, so harvest it before scripts are stripped.
  const structuredData = extractJsonLd(html)
  const links = extractLinks(url, html)

  const withoutComments = html.replace(/<!--[\s\S]*?-->/g, ' ')
  const contentHtml = stripTags(withoutComments, NON_CONTENT_TAGS)

  const rawTitle = firstMatch(contentHtml, /<title[^>]*>([\s\S]*?)<\/title>/i)
  const title = rawTitle === null ? null : decodeEntities(rawTitle).trim() || null
  const ogTitle = metaContent(contentHtml, 'property', 'og:title')
  const metaDescription =
    metaContent(contentHtml, 'name', 'description') ??
    metaContent(contentHtml, 'property', 'og:description')

  const headings = collectMatches(contentHtml, /<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi)
    .map(toText)
    .filter(isMeaningfulLine)
    .slice(0, MAX_HEADINGS)

  const lines = toLines(contentHtml)
  const priceLines = lines.filter(hasPrice).slice(0, MAX_PRICE_LINES)
  const priceSet = new Set(priceLines)
  const textBlocks = lines.filter((line) => !priceSet.has(line)).slice(0, MAX_TEXT_BLOCKS)

  const images = extractImages(url, contentHtml)
  // Contact details are as often printed as prose as they are linked, so both
  // are collected. Links come first: they are unambiguous.
  const bodyText = [...headings, ...lines].join('\n')
  const emails = uniq([
    ...links.filter((l) => l.url.startsWith('mailto:')).map((l) => l.url.slice(7).split('?')[0] ?? ''),
    ...findEmails(bodyText),
  ]).filter((value) => value.includes('@'))

  // JSON-LD is the business stating its own number in a schema, so it ranks
  // above prose. It is listed after `tel:` links only because those are just
  // as unambiguous and already came first.
  const phones = uniq([
    ...links.filter((l) => l.url.startsWith('tel:')).map((l) => l.url.slice(4).replace(/[^\d+]/g, '')),
    ...findJsonLdPhones(structuredData),
    ...findPhones(bodyText),
  ]).filter((value) => value.replace(/\D/g, '').length >= 7)

  const httpLinks = links.filter((l) => l.url.startsWith('http'))
  const socialLinks = uniq(
    httpLinks.filter((l) => SOCIAL_HOSTS.some((host) => hostOf(l.url).endsWith(host))).map((l) => l.url),
  ).slice(0, 15)

  const textLength =
    (title?.length ?? 0) +
    (metaDescription?.length ?? 0) +
    headings.join(' ').length +
    textBlocks.join(' ').length +
    priceLines.join(' ').length

  return {
    url,
    title,
    ogTitle,
    metaDescription,
    headings,
    textBlocks,
    priceLines,
    links: httpLinks.slice(0, MAX_LINKS),
    images,
    emails,
    phones,
    socialLinks,
    structuredData,
    textLength,
  }
}

/* --- internals --------------------------------------------------------- */

function stripTags(html: string, tags: string[]): string {
  let output = html
  for (const tag of tags) {
    output = output.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?</${tag}>`, 'gi'), ' ')
    // Unclosed or self-closing variants.
    output = output.replace(new RegExp(`<${tag}\\b[^>]*/?>`, 'gi'), ' ')
  }
  return output
}

/**
 * Turns markup into readable lines.
 *
 * Block-level boundaries become newlines so a menu list does not collapse into
 * one run-on sentence; everything else is dropped.
 */
function toLines(html: string): string[] {
  const withBreaks = html
    .replace(/<(br|hr)\b[^>]*>/gi, '\n')
    .replace(/<\/(p|div|li|tr|td|th|h[1-6]|section|article|header|footer|nav|ul|ol|dl|dd|dt|table|figcaption|blockquote|span|a)>/gi, '\n')
    .replace(/<(p|div|li|tr|section|article|h[1-6])\b[^>]*>/gi, '\n')

  const text = decodeEntities(withBreaks.replace(/<[^>]+>/g, ' '))

  const seen = new Set<string>()
  const lines: string[] = []

  for (const raw of text.split('\n')) {
    const line = raw.replace(/[ \t\u00a0]+/g, ' ').trim()
    if (!isMeaningfulLine(line)) continue
    if (seen.has(line)) continue
    seen.add(line)
    lines.push(line.length > 400 ? `${line.slice(0, 400)}…` : line)
  }

  return lines
}

function isMeaningfulLine(line: string): boolean {
  if (line.length < 2) return false
  // A line with no letters is punctuation, an icon glyph or a stray separator.
  if (!/[a-zA-ZÀ-ɏ]/.test(line)) return false
  if (BOILERPLATE_PATTERNS.some((pattern) => pattern.test(line))) return false
  return true
}

/**
 * True when a line quotes a price.
 *
 * Note the missing word boundary after the currency word: Malaysian sites
 * overwhelmingly write "RM12.90" with no space, so requiring one would miss
 * most of the menu.
 */
function hasPrice(line: string): boolean {
  return (
    /\b(?:rm|myr|ringgit)\s*\.?\d/i.test(line) ||
    /[$€£¥]\s*\d/.test(line) ||
    /\d(?:[.,]\d{2})?\s*(?:rm|myr|ringgit)\b/i.test(line)
  )
}

const EMAIL_PATTERN = /[a-z0-9._%+-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}/gi

/** Phone-shaped runs, validated afterwards rather than by an ever-longer regex. */
const PHONE_PATTERN = /(?:\+\d{1,3}[\s.-]?)?\(?\d{2,4}\)?[\s.-]?\d{3,4}[\s.-]?\d{3,4}/g

function findEmails(text: string): string[] {
  return uniq((text.match(EMAIL_PATTERN) ?? []).map((value) => value.toLowerCase())).slice(0, 10)
}

/**
 * Phone numbers printed as text.
 *
 * Kept deliberately strict — an unanchored number pattern will happily match
 * prices, dates and postcodes, and a wrong phone number in the Business Brain
 * is worse than a missing one.
 */
function findPhones(text: string): string[] {
  const found: string[] = []

  for (const candidate of text.match(PHONE_PATTERN) ?? []) {
    const digits = candidate.replace(/\D/g, '')
    if (digits.length < 9 || digits.length > 13) continue
    // A real number is written with separators or an international prefix.
    if (!/[\s.()-]/.test(candidate) && !candidate.startsWith('+')) continue
    if (!/^[+0(]/.test(candidate.trim())) continue
    found.push(candidate.trim())
    if (found.length >= 10) break
  }

  return uniq(found)
}

/**
 * Phone numbers the site publishes about itself in JSON-LD.
 *
 * `telephone` can sit anywhere in the graph — on the Organization, on a nested
 * `location`, inside `@graph`, or on each branch of a chain — so the whole
 * payload is walked rather than only its top level.
 *
 * The value is trusted more than prose but not blindly: schema.org says
 * `telephone` is Text, and sites do put "call us" and empty strings there. The
 * digit-count floor is the same one applied to every other source, so this
 * does not loosen the rule, it only adds a place to look.
 */
function findJsonLdPhones(payloads: unknown[]): string[] {
  const found: string[] = []

  const walk = (node: unknown, depth: number): void => {
    if (found.length >= 10 || depth > 8 || node === null || typeof node !== 'object') return

    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1)
      return
    }

    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (key.toLowerCase() === 'telephone') {
        for (const candidate of Array.isArray(value) ? value : [value]) {
          if (typeof candidate !== 'string') continue
          const trimmed = candidate.replace(/^tel:/i, '').trim()
          const digits = trimmed.replace(/\D/g, '')
          if (digits.length < 7 || digits.length > 15) continue
          found.push(trimmed)
          if (found.length >= 10) return
        }
        continue
      }
      walk(value, depth + 1)
    }
  }

  for (const payload of payloads) walk(payload, 0)

  return uniq(found)
}

function extractLinks(baseUrl: string, html: string): ExtractedLink[] {
  const results: ExtractedLink[] = []
  const seen = new Set<string>()
  const pattern = /<a\b[^>]*href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s">]+))[^>]*>([\s\S]*?)<\/a>/gi

  let match: RegExpExecArray | null
  while ((match = pattern.exec(html)) !== null) {
    const href = (match[1] ?? match[2] ?? match[3] ?? '').trim()
    if (!href) continue

    const resolved = resolve(baseUrl, href)
    if (!resolved || seen.has(resolved)) continue
    seen.add(resolved)

    results.push({ url: resolved, text: toText(match[4] ?? '') })
    if (results.length >= MAX_LINKS * 2) break
  }

  return results
}

function extractImages(baseUrl: string, html: string): string[] {
  const og = metaContent(html, 'property', 'og:image')
  const found: string[] = []
  if (og) {
    const resolved = resolve(baseUrl, og)
    if (resolved) found.push(resolved)
  }

  const pattern = /<img\b[^>]*?\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s">]+))/gi
  let match: RegExpExecArray | null
  while ((match = pattern.exec(html)) !== null && found.length < MAX_IMAGES) {
    const src = (match[1] ?? match[2] ?? match[3] ?? '').trim()
    if (!src || src.startsWith('data:')) continue
    const resolved = resolve(baseUrl, src)
    if (resolved && resolved.startsWith('http') && !found.includes(resolved)) found.push(resolved)
  }

  return found.slice(0, MAX_IMAGES)
}

function extractJsonLd(html: string): unknown[] {
  const pattern = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  const payloads: unknown[] = []

  let match: RegExpExecArray | null
  while ((match = pattern.exec(html)) !== null && payloads.length < 10) {
    const raw = (match[1] ?? '').trim()
    if (!raw || raw.length > 100_000) continue
    try {
      payloads.push(JSON.parse(raw))
    } catch {
      // Malformed JSON-LD is common and not worth failing the page over.
    }
  }

  return payloads
}

function metaContent(html: string, attribute: string, name: string): string | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(
    `<meta\\b[^>]*${attribute}\\s*=\\s*["']${escaped}["'][^>]*content\\s*=\\s*["']([^"']*)["']`,
    'i',
  )
  const alternate = new RegExp(
    `<meta\\b[^>]*content\\s*=\\s*["']([^"']*)["'][^>]*${attribute}\\s*=\\s*["']${escaped}["']`,
    'i',
  )
  const value = pattern.exec(html)?.[1] ?? alternate.exec(html)?.[1]
  const decoded = value ? decodeEntities(value).trim() : ''
  return decoded || null
}

function firstMatch(html: string, pattern: RegExp): string | null {
  const value = pattern.exec(html)?.[1]
  if (!value) return null
  const text = toText(value)
  return text || null
}

function collectMatches(html: string, pattern: RegExp): string[] {
  const results: string[] = []
  let match: RegExpExecArray | null
  while ((match = pattern.exec(html)) !== null) {
    if (match[1]) results.push(match[1])
    if (results.length > 500) break
  }
  return results
}

function toText(fragment: string): string {
  return decodeEntities(fragment.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  rsquo: '’',
  lsquo: '‘',
  ldquo: '“',
  rdquo: '”',
  middot: '·',
  bull: '•',
  eacute: 'é',
  copy: '©',
  reg: '®',
  trade: '™',
  deg: '°',
}

function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    if (entity.startsWith('#')) {
      const isHex = entity[1] === 'x' || entity[1] === 'X'
      const code = Number.parseInt(isHex ? entity.slice(2) : entity.slice(1), isHex ? 16 : 10)
      if (Number.isFinite(code) && code > 0 && code <= 0x10ffff) {
        try {
          return String.fromCodePoint(code)
        } catch {
          return match
        }
      }
      return match
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? match
  })
}

function resolve(baseUrl: string, href: string): string | null {
  if (/^(javascript|data|vbscript):/i.test(href)) return null
  if (href.startsWith('#')) return null
  if (href.startsWith('mailto:') || href.startsWith('tel:')) return href

  try {
    const url = new URL(href, baseUrl)
    url.hash = ''
    return url.toString()
  } catch {
    return null
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return ''
  }
}

function uniq(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))]
}
