/**
 * Client-side website URL checking.
 *
 * This exists to fail fast and kindly, not to enforce anything. The backend
 * validates and normalises the URL again — and only trusts its own result —
 * because anything decided in the browser can be edited by the person using
 * it. Keeping a copy here just means a typo gets an instant answer instead of
 * a round trip.
 */

const MAX_URL_LENGTH = 2048

export interface UrlCheck {
  ok: boolean
  /** The URL as it will be sent. Only meaningful when `ok`. */
  url: string
  /** Wording taken from the product copy, shown under the field. */
  message: string | null
}

const INVALID = 'That doesn’t look like a valid website URL.'

/**
 * Accepts what people actually type — `warungpakdin.com`, with or without a
 * scheme — and returns the absolute URL, or a plain-English refusal.
 */
export function checkWebsiteUrl(raw: string): UrlCheck {
  const trimmed = raw.trim()
  if (!trimmed) return { ok: false, url: '', message: INVALID }
  if (trimmed.length > MAX_URL_LENGTH) return { ok: false, url: '', message: INVALID }
  if (/\s/.test(trimmed)) return { ok: false, url: '', message: INVALID }

  const typedWeb = /^https?:\/\//i.test(trimmed)

  // Any other scheme is a different kind of thing entirely — `mailto:`,
  // `file:`, `javascript:` — and must not be quietly rewritten into a website.
  // A colon followed by digits is a port, not a scheme.
  if (!typedWeb && /^[a-z][a-z0-9+.-]*:(?!\d)/i.test(trimmed)) {
    return { ok: false, url: '', message: INVALID }
  }

  // Likewise an email address pasted into the wrong field: guessing at the
  // domain behind it would analyse a site the owner never named.
  if (!typedWeb && trimmed.includes('@')) return { ok: false, url: '', message: INVALID }

  // A bare domain is the common case, so assume https rather than reject it.
  const candidate = typedWeb ? trimmed : `https://${trimmed}`

  let parsed: URL
  try {
    parsed = new URL(candidate)
  } catch {
    return { ok: false, url: '', message: INVALID }
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, url: '', message: INVALID }
  }

  const hostname = parsed.hostname.toLowerCase()
  // A public site always has a dot and a letter-only ending.
  if (!/^[a-z0-9.-]+$/.test(hostname) || !/\.[a-z]{2,}$/.test(hostname)) {
    return { ok: false, url: '', message: INVALID }
  }

  parsed.hash = ''
  parsed.username = ''
  parsed.password = ''

  return { ok: true, url: parsed.toString(), message: null }
}

/** "warungpakdin.com" — for headings, where the scheme is just noise. */
export function displayHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}
