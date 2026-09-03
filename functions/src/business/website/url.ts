/**
 * URL validation and normalisation for user-supplied website addresses.
 *
 * This is the first line of the SSRF defence and it is deliberately pure: no
 * network, no DNS, no Firestore. Everything here can be reasoned about and
 * tested in isolation, which is what a security boundary needs.
 *
 * The rule is allow-list, not deny-list. A URL has to look like a public
 * website on a standard port before it is considered at all.
 */

export type UrlRejectionReason =
  | 'empty'
  | 'too_long'
  | 'unparseable'
  | 'unsupported_scheme'
  | 'credentials_in_url'
  | 'unsupported_port'
  | 'not_a_hostname'
  | 'blocked_host'

export class InvalidUrlError extends Error {
  constructor(readonly reason: UrlRejectionReason) {
    super(`Rejected website URL: ${reason}`)
    this.name = 'InvalidUrlError'
  }
}

const MAX_URL_LENGTH = 2048

/** Ports a public website is actually served on. Anything else is a scan. */
const ALLOWED_PORTS = new Set(['', '80', '443'])

/**
 * Hostnames that resolve inside a network rather than on the internet.
 * DNS resolution is checked separately in `guard.ts`; this catches the
 * obvious attempts before a lookup is ever made.
 */
const BLOCKED_HOST_SUFFIXES = [
  '.localhost',
  '.local',
  '.internal',
  '.home.arpa',
  '.lan',
  '.intranet',
  '.private',
]

const BLOCKED_HOSTS = new Set([
  'localhost',
  'metadata',
  'metadata.google.internal',
  'instance-data',
  'nsx',
])

/**
 * Turns whatever the user typed into a canonical absolute URL.
 *
 * Accepts "example.com", "www.example.com/menu", "HTTPS://Example.com/".
 * Throws `InvalidUrlError` for anything that is not a fetchable public page.
 */
export function normalizeWebsiteUrl(input: string): string {
  const trimmed = stripWrapping(input)
  if (!trimmed) throw new InvalidUrlError('empty')
  if (trimmed.length > MAX_URL_LENGTH) throw new InvalidUrlError('too_long')

  // A bare domain is the common case — people rarely type the scheme.
  const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)
    ? trimmed
    : `https://${trimmed}`

  let url: URL
  try {
    url = new URL(withScheme)
  } catch {
    throw new InvalidUrlError('unparseable')
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new InvalidUrlError('unsupported_scheme')
  }

  // `https://user:pass@internal-host@example.com` style confusion.
  if (url.username || url.password) {
    throw new InvalidUrlError('credentials_in_url')
  }

  if (!ALLOWED_PORTS.has(url.port)) {
    throw new InvalidUrlError('unsupported_port')
  }

  const hostname = canonicalHostname(url.hostname)
  if (!hostname) throw new InvalidUrlError('not_a_hostname')

  assertHostnameAllowed(hostname)

  url.hostname = hostname
  url.hash = ''
  // The default port carries no information and breaks same-origin comparison.
  if ((url.protocol === 'https:' && url.port === '443') || (url.protocol === 'http:' && url.port === '80')) {
    url.port = ''
  }

  return url.toString()
}

/** True when `input` normalises cleanly. Used for cheap client-side checks. */
export function isValidWebsiteUrl(input: string): boolean {
  try {
    normalizeWebsiteUrl(input)
    return true
  } catch {
    return false
  }
}

/** Strips whitespace and the quotes/angle brackets people paste along with a URL. */
function stripWrapping(input: string): string {
  return String(input ?? '')
    .trim()
    .replace(/^[<"'\s]+/, '')
    .replace(/[>"'\s]+$/, '')
}

/** Lowercases, removes the FQDN trailing dot, and unwraps IPv6 brackets. */
export function canonicalHostname(hostname: string): string {
  const lower = hostname.trim().toLowerCase().replace(/\.$/, '')
  return lower
}

/**
 * Throws unless the hostname could plausibly belong to a public website.
 *
 * IP literals are refused outright: a restaurant's website has a domain name,
 * and accepting a literal removes the DNS step that the guard depends on.
 */
export function assertHostnameAllowed(hostname: string): void {
  if (!hostname) throw new InvalidUrlError('not_a_hostname')

  if (BLOCKED_HOSTS.has(hostname)) throw new InvalidUrlError('blocked_host')
  if (BLOCKED_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) {
    throw new InvalidUrlError('blocked_host')
  }

  // Bracketed IPv6, bare IPv6, or IPv4 literal.
  if (hostname.startsWith('[') || hostname.includes(':') || parseIpv4(hostname)) {
    throw new InvalidUrlError('blocked_host')
  }

  // A real registrable domain: at least one dot and an alphabetic TLD.
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}$/.test(hostname)) {
    throw new InvalidUrlError('not_a_hostname')
  }
}

/** Returns the four octets, or null when `value` is not a dotted-quad IPv4. */
export function parseIpv4(value: string): number[] | null {
  const parts = value.split('.')
  if (parts.length !== 4) return null

  const octets: number[] = []
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null
    const octet = Number(part)
    if (octet > 255) return null
    octets.push(octet)
  }
  return octets
}

/** True when the address is on a network the internet cannot reach. */
export function isBlockedIpv4(value: string): boolean {
  const octets = parseIpv4(value)
  if (!octets) return false

  const [a = 0, b = 0, c = 0, d = 0] = octets

  return (
    a === 0 || // "this network"
    a === 10 || // RFC1918
    a === 127 || // loopback
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 169 && b === 254) || // link-local, incl. cloud metadata
    (a === 172 && b >= 16 && b <= 31) || // RFC1918
    (a === 192 && b === 0 && c === 0) || // IETF protocol assignments
    (a === 192 && b === 0 && c === 2) || // TEST-NET-1
    (a === 192 && b === 88 && c === 99) || // 6to4 relay anycast
    (a === 192 && b === 168) || // RFC1918
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    (a === 198 && b === 51 && c === 100) || // TEST-NET-2
    (a === 203 && b === 0 && c === 113) || // TEST-NET-3
    a >= 224 || // multicast, reserved, broadcast
    (a === 255 && b === 255 && c === 255 && d === 255)
  )
}

/**
 * True when the IPv6 address is loopback, unspecified, unique-local,
 * link-local, or an IPv4-mapped address wrapping a blocked IPv4.
 */
export function isBlockedIpv6(value: string): boolean {
  const address = value.replace(/^\[|\]$/g, '').toLowerCase().split('%')[0] ?? ''
  if (!address) return true

  if (address === '::1' || address === '::') return true

  // ::ffff:192.168.0.1 and ::ffff:c0a8:1 both wrap an IPv4 address.
  const mapped = address.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/)
  if (mapped?.[1]) return isBlockedIpv4(mapped[1])

  const head = address.split(':')[0] ?? ''
  if (!head) return false

  const group = Number.parseInt(head, 16)
  if (Number.isNaN(group)) return false

  if ((group & 0xfe00) === 0xfc00) return true // fc00::/7 unique-local
  if ((group & 0xffc0) === 0xfe80) return true // fe80::/10 link-local
  if ((group & 0xff00) === 0xff00) return true // ff00::/8 multicast

  return false
}

/** Single entry point used by the fetch guard for any resolved address. */
export function isBlockedIpAddress(value: string): boolean {
  if (parseIpv4(value)) return isBlockedIpv4(value)
  if (value.includes(':')) return isBlockedIpv6(value)
  // Not an address we can classify — refuse rather than guess.
  return true
}

/** True when `candidate` is on the same registrable host as `origin`. */
export function isSameSite(originUrl: string, candidateUrl: string): boolean {
  try {
    const origin = new URL(originUrl)
    const candidate = new URL(candidateUrl)
    if (candidate.protocol !== 'http:' && candidate.protocol !== 'https:') return false

    const a = canonicalHostname(origin.hostname).replace(/^www\./, '')
    const b = canonicalHostname(candidate.hostname).replace(/^www\./, '')
    return a === b
  } catch {
    return false
  }
}
