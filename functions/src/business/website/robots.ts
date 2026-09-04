import { assertResolvesToPublicAddress } from './guard'
import { normalizeWebsiteUrl } from './url'

/**
 * Minimal robots.txt support.
 *
 * MARKA fetches sites its users asked it to read, but it still fetches them
 * from a server, automatically, on a schedule the site owner did not choose.
 * That makes it a bot, and a bot that ignores robots.txt is a bad citizen and
 * a good way to get an IP blocked.
 *
 * Only `Disallow` under a matching `User-agent` is honoured — enough to stay
 * polite without pretending to be a full RFC 9309 implementation.
 */

const ROBOTS_TIMEOUT_MS = 5_000
const MAX_ROBOTS_BYTES = 128 * 1024
const AGENT = 'markabot'

export interface RobotsRules {
  /** Path prefixes the crawler must not request. */
  disallowed: string[]
}

/** Never blocks the crawl: an unreadable robots.txt means "no rules". */
export async function fetchRobots(siteUrl: string): Promise<RobotsRules> {
  try {
    const origin = new URL(normalizeWebsiteUrl(siteUrl)).origin
    await assertResolvesToPublicAddress(new URL(origin).hostname)

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), ROBOTS_TIMEOUT_MS)
    try {
      // `manual`, never `follow`: a redirect target here would be fetched
      // without the hostname/DNS validation every other request in this
      // module family goes through — the one SSRF hole in the pipeline. A
      // robots.txt that redirects is treated as "no rules" instead, which is
      // the same stance taken for any other unreadable robots.txt.
      const response = await fetch(`${origin}/robots.txt`, {
        redirect: 'manual',
        signal: controller.signal,
        headers: { 'user-agent': 'MarkaBot/1.0', accept: 'text/plain' },
      })
      if (!response.ok) return { disallowed: [] }

      const text = (await response.text()).slice(0, MAX_ROBOTS_BYTES)
      return parseRobots(text)
    } finally {
      clearTimeout(timer)
    }
  } catch {
    return { disallowed: [] }
  }
}

export function parseRobots(text: string): RobotsRules {
  const disallowed: string[] = []

  // Rules for a named agent win over the wildcard group, per the standard.
  let specific: string[] | null = null
  const wildcard: string[] = []
  let current: string[] | null = null

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.split('#')[0]?.trim() ?? ''
    if (!line) continue

    const separator = line.indexOf(':')
    if (separator === -1) continue

    const field = line.slice(0, separator).trim().toLowerCase()
    const value = line.slice(separator + 1).trim()

    if (field === 'user-agent') {
      const agent = value.toLowerCase()
      if (agent === AGENT) {
        specific ??= []
        current = specific
      } else if (agent === '*') {
        current = wildcard
      } else {
        current = null
      }
      continue
    }

    if (field === 'disallow' && current) {
      if (value) current.push(value)
    }
  }

  const chosen = specific ?? wildcard
  for (const path of chosen) disallowed.push(path)

  return { disallowed }
}

export function isAllowedByRobots(rules: RobotsRules, url: string): boolean {
  let pathname: string
  try {
    const parsed = new URL(url)
    pathname = `${parsed.pathname}${parsed.search}`
  } catch {
    return false
  }

  return !rules.disallowed.some((rule) => matchesRule(rule, pathname))
}

/**
 * Prefix matching, plus the two wildcards the standard defines: `*` for any
 * run of characters and a trailing `$` to anchor the end.
 *
 * Reading `Disallow: /*.pdf$` as its literal head would make it `Disallow: /`
 * and block the whole site — and that line is common enough on real
 * restaurant sites that being careless here would mean crawling nothing.
 */
function matchesRule(rule: string, pathname: string): boolean {
  if (!rule) return false
  if (rule === '/') return true

  if (!rule.includes('*') && !rule.endsWith('$')) return pathname.startsWith(rule)

  const anchored = rule.endsWith('$')
  const pattern = (anchored ? rule.slice(0, -1) : rule)
    .split('*')
    .map(escapeRegExp)
    .join('.*')

  return new RegExp(`^${pattern}${anchored ? '$' : ''}`).test(pathname)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
