/**
 * Client-side website URL checking.
 *
 * This exists to fail fast and kindly, not to enforce anything. The backend
 * validates and normalises the URL again — and only trusts its own result —
 * because anything decided in the browser can be edited by the person using
 * it. Keeping a copy here just means a typo gets an instant answer instead of
 * a round trip.
 */

import { t } from '@/i18n/store'

const MAX_URL_LENGTH = 2048

export interface UrlCheck {
  ok: boolean
  /** The URL as it will be sent. Only meaningful when `ok`. */
  url: string
  /** Wording taken from the product copy, shown under the field. */
  message: string | null
}

// Resolved through the i18n store at check time — a module-level string
// constant would freeze whichever language was active when this file loaded.
const INVALID = () => t('onboarding.invalidUrl')

/**
 * Accepts what people actually type — `warungpakdin.com`, with or without a
 * scheme — and returns the absolute URL, or a plain-English refusal.
 */
export function checkWebsiteUrl(raw: string): UrlCheck {
  const trimmed = raw.trim()
  if (!trimmed) return { ok: false, url: '', message: INVALID() }
  if (trimmed.length > MAX_URL_LENGTH) return { ok: false, url: '', message: INVALID() }
  if (/\s/.test(trimmed)) return { ok: false, url: '', message: INVALID() }

  const typedWeb = /^https?:\/\//i.test(trimmed)

  // Any other scheme is a different kind of thing entirely — `mailto:`,
  // `file:`, `javascript:` — and must not be quietly rewritten into a website.
  // A colon followed by digits is a port, not a scheme.
  if (!typedWeb && /^[a-z][a-z0-9+.-]*:(?!\d)/i.test(trimmed)) {
    return { ok: false, url: '', message: INVALID() }
  }

  // Likewise an email address pasted into the wrong field: guessing at the
  // domain behind it would analyse a site the owner never named.
  if (!typedWeb && trimmed.includes('@')) return { ok: false, url: '', message: INVALID() }

  // A bare domain is the common case, so assume https rather than reject it.
  const candidate = typedWeb ? trimmed : `https://${trimmed}`

  let parsed: URL
  try {
    parsed = new URL(candidate)
  } catch {
    return { ok: false, url: '', message: INVALID() }
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, url: '', message: INVALID() }
  }

  const hostname = parsed.hostname.toLowerCase()
  // A public site always has a dot and a letter-only ending.
  if (!/^[a-z0-9.-]+$/.test(hostname) || !/\.[a-z]{2,}$/.test(hostname)) {
    return { ok: false, url: '', message: INVALID() }
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

/* --- one link, three kinds of place ------------------------------------ */

export type DiscoverySourceKind = 'website' | 'facebook' | 'instagram'

export interface DiscoveryCheck extends UrlCheck {
  /** Only meaningful when `ok`. */
  kind: DiscoverySourceKind
}

const NOT_A_PROFILE = () => t('onboarding.notAProfile')

const FACEBOOK_NON_PAGE = new Set([
  'watch',
  'reel',
  'reels',
  'stories',
  'groups',
  'events',
  'marketplace',
  'gaming',
  'share',
  'sharer',
  'sharer.php',
  'photo',
  'photo.php',
  'photos',
  'videos',
  'posts',
  'hashtag',
  'login',
  'login.php',
  'help',
  'policies',
  'legal',
])

const INSTAGRAM_NON_PROFILE = new Set([
  'p',
  'reel',
  'reels',
  'tv',
  'stories',
  'explore',
  'accounts',
  'direct',
  'about',
  'legal',
])

/**
 * The onboarding field accepts one link: a website, a Facebook Page, or an
 * Instagram profile. Like `checkWebsiteUrl`, this is a kindness, not a rule
 * — the backend decides for real (`functions/src/business/discovery/source.ts`
 * is the authority, and stricter). Canonicalising here just means the URL the
 * owner sees confirmed is the page, not the tracking junk around it.
 */
export function checkDiscoveryUrl(raw: string): DiscoveryCheck {
  const base = checkWebsiteUrl(raw)
  if (!base.ok) return { ...base, kind: 'website' }

  let parsed: URL
  try {
    parsed = new URL(base.url)
  } catch {
    return { ok: false, url: '', message: INVALID(), kind: 'website' }
  }

  const host = parsed.hostname.toLowerCase().replace(/^(www|m|web|mbasic)\./, '')

  if (host === 'facebook.com' || host === 'fb.com') return facebookCheck(parsed)
  if (host === 'instagram.com') return instagramCheck(parsed)

  return { ...base, kind: 'website' }
}

function facebookCheck(parsed: URL): DiscoveryCheck {
  const segments = parsed.pathname.split('/').filter(Boolean)
  const first = (segments[0] ?? '').toLowerCase()

  if (first === 'profile.php') {
    const id = parsed.searchParams.get('id') ?? ''
    if (!/^\d{5,25}$/.test(id)) return refuse()
    return {
      ok: true,
      url: `https://www.facebook.com/profile.php?id=${id}`,
      message: null,
      kind: 'facebook',
    }
  }

  if (first === 'pages') {
    const slug = segments[1]
    const id = segments[2]
    if (!slug || !id || !/^\d+$/.test(id)) return refuse()
    return {
      ok: true,
      url: `https://www.facebook.com/pages/${encodeURIComponent(slug)}/${id}`,
      message: null,
      kind: 'facebook',
    }
  }

  if (!first || FACEBOOK_NON_PAGE.has(first) || !/^[a-z0-9.\-_]{2,80}$/.test(first)) {
    return refuse()
  }

  return {
    ok: true,
    url: `https://www.facebook.com/${segments[0]}/`,
    message: null,
    kind: 'facebook',
  }
}

function instagramCheck(parsed: URL): DiscoveryCheck {
  const first = (parsed.pathname.split('/').filter(Boolean)[0] ?? '').toLowerCase()

  if (
    !first ||
    INSTAGRAM_NON_PROFILE.has(first) ||
    !/^[a-z0-9](?:[a-z0-9._]{0,28}[a-z0-9_])?$/.test(first)
  ) {
    return refuse()
  }

  return {
    ok: true,
    url: `https://www.instagram.com/${first}/`,
    message: null,
    kind: 'instagram',
  }
}

function refuse(): DiscoveryCheck {
  return { ok: false, url: '', message: NOT_A_PROFILE(), kind: 'website' }
}

/** "facebook.com/warungpakdin" — for headings; scheme and www are noise. */
export function displaySource(url: string): string {
  try {
    const parsed = new URL(url)
    const host = parsed.hostname.replace(/^www\./, '')
    if (host !== 'facebook.com' && host !== 'instagram.com') return host

    const id = parsed.searchParams.get('id')
    if (id) return `${host}/profile ${id}`
    const segments = parsed.pathname.split('/').filter(Boolean)
    const handle = segments[0] === 'pages' ? segments[1] : segments[0]
    return handle ? `${host}/${handle}` : host
  } catch {
    return url
  }
}
