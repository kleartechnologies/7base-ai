import { normalizeWebsiteUrl } from '../website/url'

/**
 * Which kind of place the owner pointed EVA at.
 *
 * Many Malaysian SMEs have no website; their public presence is a Facebook
 * Page or an Instagram profile. Discovery therefore starts from "a link",
 * not "a website" — and this module decides, deterministically, what that
 * link is. No model is consulted: a hostname is not a judgement call, and
 * spending an AI request to read one would be waste.
 *
 * Every input goes through `normalizeWebsiteUrl` FIRST, so a social URL gets
 * exactly the same SSRF scrutiny as a website URL — scheme, credentials,
 * ports, IP literals, internal names. Nothing about being "facebook.com
 * shaped" earns a URL a way around those checks.
 */

export type DiscoverySourceKind = 'website' | 'facebook' | 'instagram'

export interface DiscoverySource {
  kind: DiscoverySourceKind
  /** The exact URL discovery will fetch, canonicalised per platform. */
  url: string
}

/** A social link that is real but not a page/profile — a post, a video, a group. */
export class UnsupportedSocialUrlError extends Error {
  constructor(readonly userMessage: string) {
    super(userMessage)
    this.name = 'UnsupportedSocialUrlError'
  }
}

const NOT_A_PROFILE =
  'That looks like a link to a post or video, not a page. Paste the link to your page or profile instead.'

const NO_PAGE_NAMED =
  'That link does not point at a page. Paste the full link to your page or profile — the one with your business name in it.'

/** Facebook front-ends people actually paste. All collapse to www. */
const FACEBOOK_HOSTS = new Set([
  'facebook.com',
  'www.facebook.com',
  'm.facebook.com',
  'mbasic.facebook.com',
  'web.facebook.com',
  'fb.com',
  'www.fb.com',
])

const INSTAGRAM_HOSTS = new Set(['instagram.com', 'www.instagram.com', 'm.instagram.com'])

/**
 * Facebook path segments that can never lead to a business Page. `sharer`,
 * `watch` and friends are products; `login` and `checkpoint` are walls.
 */
const FACEBOOK_NON_PAGE_SEGMENTS = new Set([
  'watch',
  'reel',
  'reels',
  'stories',
  'story.php',
  'groups',
  'events',
  'marketplace',
  'gaming',
  'games',
  'sharer',
  'sharer.php',
  'share',
  'share.php',
  'photo',
  'photo.php',
  'photos',
  'video.php',
  'videos',
  'posts',
  'notes',
  'hashtag',
  'search',
  'login',
  'login.php',
  'checkpoint',
  'recover',
  'help',
  'policies',
  'legal',
  'settings',
  'home.php',
  'dialog',
])

/** Instagram segments that are posts, products or walls — never a profile. */
const INSTAGRAM_NON_PROFILE_SEGMENTS = new Set([
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
  'developer',
  'directory',
  'invites',
])

const INSTAGRAM_HANDLE = /^[a-z0-9](?:[a-z0-9._]{0,28}[a-z0-9_])?$/

/**
 * Facebook vanity names: letters, digits and dots, at least 5 characters in
 * real life — but old pages and localised slugs break every published rule,
 * so this only refuses shapes that cannot possibly be a page name.
 */
const FACEBOOK_PAGE_NAME = /^[a-z0-9.\-_]{2,80}$/

export function detectDiscoverySource(raw: string): DiscoverySource {
  // Full validation first. Anything that survives is http(s), credential-free,
  // on a web port, at a public registrable name.
  const normalized = normalizeWebsiteUrl(raw)
  const url = new URL(normalized)
  const host = url.hostname.toLowerCase()

  if (FACEBOOK_HOSTS.has(host)) return facebookSource(url)
  if (INSTAGRAM_HOSTS.has(host)) return instagramSource(url)

  return { kind: 'website', url: normalized }
}

/** Non-throwing form, for callers that just want to know what a URL is. */
export function tryDetectDiscoverySource(raw: string): DiscoverySource | null {
  try {
    return detectDiscoverySource(raw)
  } catch {
    return null
  }
}

function facebookSource(url: URL): DiscoverySource {
  const segments = url.pathname.split('/').filter(Boolean)
  const first = (segments[0] ?? '').toLowerCase()

  if (!first) throw new UnsupportedSocialUrlError(NO_PAGE_NAMED)

  // Unnamed pages: facebook.com/profile.php?id=61550000000000 — the id query
  // parameter IS the identity, so it survives canonicalisation. This is the
  // only query string discovery ever keeps.
  if (first === 'profile.php') {
    const id = url.searchParams.get('id') ?? ''
    if (!/^\d{5,25}$/.test(id)) throw new UnsupportedSocialUrlError(NOT_A_PROFILE)
    return { kind: 'facebook', url: `https://www.facebook.com/profile.php?id=${id}` }
  }

  // Legacy page URLs: facebook.com/pages/Warung-Pak-Din/123456789 — keep the
  // path as pasted (minus anything after the numeric id).
  if (first === 'pages') {
    const slug = segments[1]
    const id = segments[2]
    if (!slug || !id || !/^\d+$/.test(id)) throw new UnsupportedSocialUrlError(NOT_A_PROFILE)
    return {
      kind: 'facebook',
      url: `https://www.facebook.com/pages/${encodeURIComponent(slug)}/${id}`,
    }
  }

  if (FACEBOOK_NON_PAGE_SEGMENTS.has(first)) throw new UnsupportedSocialUrlError(NOT_A_PROFILE)
  if (!FACEBOOK_PAGE_NAME.test(first)) throw new UnsupportedSocialUrlError(NOT_A_PROFILE)

  // Deeper paths (…/about, …/menu, …/posts/123) are views of the page —
  // truncate to the page itself rather than refusing a link that plainly
  // names the right business.
  return { kind: 'facebook', url: `https://www.facebook.com/${segments[0]}/` }
}

function instagramSource(url: URL): DiscoverySource {
  const segments = url.pathname.split('/').filter(Boolean)
  const first = (segments[0] ?? '').toLowerCase()

  if (!first) throw new UnsupportedSocialUrlError(NO_PAGE_NAMED)
  if (INSTAGRAM_NON_PROFILE_SEGMENTS.has(first)) throw new UnsupportedSocialUrlError(NOT_A_PROFILE)
  if (!INSTAGRAM_HANDLE.test(first)) throw new UnsupportedSocialUrlError(NOT_A_PROFILE)

  // instagram.com/<handle>/reels/ and similar are tabs of the profile.
  return { kind: 'instagram', url: `https://www.instagram.com/${first}/` }
}
