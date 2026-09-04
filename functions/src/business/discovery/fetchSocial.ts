import { InsufficientContentError } from '../brain/validate'
import { SiteUnreachableError } from '../website/crawl'
import { extractPage } from '../website/extract'
import { fetchPage, PageFetchError, type FetchedPage } from '../website/fetchPage'
import { buildSocialCorpus, isSocialContentSufficient, isSocialLoginWall } from './socialPage'
import type { DiscoverySource } from './source'

/**
 * Fetches and flattens one public social page, with a single bounded retry.
 *
 * Facebook and Instagram decide PER REQUEST whether an anonymous server gets
 * the public representation, a login wall, or a throttle — the same URL
 * genuinely produces different responses minutes apart (verified against live
 * pages during Phase 6G). One unlucky response must therefore not become
 * "EVA couldn't analyse your business", so a recoverable outcome earns
 * exactly one more attempt at the same canonical URL.
 *
 * Why the same URL and not another representation: m.facebook.com and
 * mbasic.facebook.com serve anonymous visitors a login redirect outright
 * (probed during this phase) — they are worse, not better. The canonical
 * www page is the representation the platforms actually publish to
 * anonymous readers; per-request variability is what the retry addresses.
 *
 * Hard bounds: at most {@link SOCIAL_FETCH_ATTEMPTS} fetches, a fixed
 * {@link SOCIAL_RETRY_DELAY_MS} pause between them, no AI spend until content
 * is sufficient, and the existing 15-second re-analysis cooldown untouched.
 * Every attempt goes through `fetchPage` unchanged — same SSRF guard, DNS
 * re-check, redirect revalidation, timeout and size cap. Nothing here logs
 * in, sends cookies, or works around platform access controls: a page the
 * platform will not show an anonymous reader stays unread.
 */

export const SOCIAL_FETCH_ATTEMPTS = 2

export const SOCIAL_RETRY_DELAY_MS = 1_500

/**
 * The page exists but a server cannot see it: a login wall, a private or
 * restricted account, or the platform refusing anonymous readers. Nothing the
 * owner can retry their way out of — the manual flow is the answer.
 */
export class NotPublicError extends Error {
  constructor() {
    super('Social page is not publicly readable')
    this.name = 'NotPublicError'
  }
}

/**
 * Every attempt was answered with a rate-limit (429). Unlike a login wall
 * this is temporary by definition — the owner should be told to try again,
 * not that their page is private.
 */
export class SocialThrottledError extends Error {
  constructor() {
    super('Social platform throttled the request')
    this.name = 'SocialThrottledError'
  }
}

export interface SocialProfileContent {
  corpus: string
  signals: { emails: string[]; phones: string[]; outboundLinks: string[] }
}

/** Injectable seams so the retry ladder is testable without a network. */
export interface SocialFetchDeps {
  fetchPage: (url: string) => Promise<FetchedPage>
  delay: (ms: number) => Promise<void>
}

const REAL_DEPS: SocialFetchDeps = {
  fetchPage,
  delay: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}

export async function fetchSocialProfile(
  source: DiscoverySource,
  deps: SocialFetchDeps = REAL_DEPS,
): Promise<SocialProfileContent> {
  let sawThin = false
  let sawThrottle = false
  let sawWall = false
  let lastUnreachable: SiteUnreachableError | null = null

  for (let attempt = 1; attempt <= SOCIAL_FETCH_ATTEMPTS; attempt += 1) {
    if (attempt > 1) await deps.delay(SOCIAL_RETRY_DELAY_MS)

    let fetched: FetchedPage
    try {
      fetched = await deps.fetchPage(source.url)
    } catch (error) {
      // Only transport/HTTP outcomes are ever retried. Anything else —
      // including the SSRF guard's BlockedHostError/UnresolvableHostError —
      // is a refusal, not bad luck, and passes straight through.
      if (!(error instanceof PageFetchError)) throw error

      // A vanished page (404/410) stays vanished; retrying is pointless.
      if (error.failure === 'not_found') throw new NotPublicError()

      if (error.failure === 'blocked') {
        // 429 is throttling; 401/403 from these platforms is per-request
        // anti-bot as often as it is policy. Both are worth one more try.
        if (error.status === 429) sawThrottle = true
        else sawWall = true
        continue
      }

      // timeout / reset / refused / tls / dns / http_error / not_html /
      // too_large / unreachable: keep the finest-grained reason we saw.
      lastUnreachable = new SiteUnreachableError(source.url, error.failure)
      continue
    }

    const page = extractPage(fetched.url, fetched.html)
    if (isSocialLoginWall(source.kind, fetched.url, page)) {
      sawWall = true
      continue
    }

    const social = buildSocialCorpus(source.kind, page)
    if (!isSocialContentSufficient(social)) {
      // A real page, but thinner than this response usually is — the next
      // response may carry the description this one dropped.
      sawThin = true
      continue
    }

    return { corpus: social.corpus, signals: social.signals }
  }

  // Every attempt failed. Report the most accurate thing that happened:
  // a real-but-thin page beats guessing "private"; a throttle is honest
  // about being temporary; a wall means the manual flow; transport failures
  // keep their transport reason.
  if (sawThin) throw new InsufficientContentError()
  if (sawThrottle) throw new SocialThrottledError()
  if (sawWall) throw new NotPublicError()
  throw lastUnreachable ?? new SiteUnreachableError(source.url, 'unreachable')
}
