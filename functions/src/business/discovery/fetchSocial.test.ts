import { describe, expect, it } from 'vitest'
import { InsufficientContentError } from '../brain/validate'
import { SiteUnreachableError } from '../website/crawl'
import { PageFetchError, type FetchedPage } from '../website/fetchPage'
import {
  fetchSocialProfile,
  NotPublicError,
  SOCIAL_FETCH_ATTEMPTS,
  SOCIAL_RETRY_DELAY_MS,
  SocialThrottledError,
  type SocialFetchDeps,
} from './fetchSocial'
import type { DiscoverySource } from './source'

/**
 * The bounded recovery ladder, exercised without a network.
 *
 * The fixtures mirror what Facebook actually serves an anonymous server
 * (captured live during Phase 6G): a ~1 MB script shell whose only readable
 * business information is the <title> and the description meta tags — or,
 * on an unlucky request, a login redirect, a throttle, or a shell with the
 * description dropped. The ladder's job is to keep one unlucky response
 * from becoming "EVA couldn't analyse your business".
 */

const SOURCE: DiscoverySource = {
  kind: 'facebook',
  url: 'https://www.facebook.com/nasiarabalshams/',
}

/** The metadata-rich script shell — the representation a lucky request gets. */
const RICH_SHELL = `<!DOCTYPE html><html><head>
<title>Nasi Arab AlShams Bukit Changgang | Banting</title>
<meta property="og:title" content="Nasi Arab AlShams Bukit Changgang | Banting" />
<meta property="og:description" content="Nasi Arab AlShams Bukit Changgang, Banting. 1,967 likes &#183; 408 talking about this &#183; 7 were here. Arabic Restaurant &amp; Cafe" />
<meta name="description" content="Nasi Arab AlShams Bukit Changgang, Banting. 1,967 likes &#183; 408 talking about this &#183; 7 were here. Arabic Restaurant &amp; Cafe" />
</head><body><script>window.__d=${'x'.repeat(2000)}</script></body></html>`

/** The same page on an unlucky request: description dropped, body still scripts. */
const THIN_SHELL = `<!DOCTYPE html><html><head>
<title>Kedai Salmiah | Banting</title>
</head><body><script>window.__d={}</script></body></html>`

/** What a login wall serves when it answers 200 instead of redirecting. */
const WALL_SHELL = `<!DOCTYPE html><html><head>
<title>Facebook - log in or sign up</title>
</head><body><script>requireLogin()</script></body></html>`

type Step =
  | { html: string; finalUrl?: string }
  | { throw: Error }

function harness(steps: Step[]) {
  const fetches: string[] = []
  const delays: number[] = []

  const deps: SocialFetchDeps = {
    fetchPage: (url: string): Promise<FetchedPage> => {
      fetches.push(url)
      const step = steps.shift()
      if (!step) throw new Error('fetchPage called more times than the test scripted')
      if ('throw' in step) return Promise.reject(step.throw)
      return Promise.resolve({ url: step.finalUrl ?? url, html: step.html, status: 200 })
    },
    delay: (ms: number) => {
      delays.push(ms)
      return Promise.resolve()
    },
  }

  return { deps, fetches, delays }
}

describe('fetchSocialProfile recovery ladder', () => {
  it('succeeds on the first attempt with no extra request and no delay', async () => {
    const { deps, fetches, delays } = harness([{ html: RICH_SHELL }])

    const result = await fetchSocialProfile(SOURCE, deps)

    expect(fetches).toEqual([SOURCE.url])
    expect(delays).toEqual([])
    expect(result.corpus).toContain('Nasi Arab AlShams Bukit Changgang | Banting')
    expect(result.corpus).toContain('Arabic Restaurant & Cafe')
    expect(result.corpus).toContain('Banting')
  })

  it('recovers when a login wall is followed by the public representation', async () => {
    const { deps, fetches, delays } = harness([
      { html: WALL_SHELL, finalUrl: 'https://www.facebook.com/login/?next=x' },
      { html: RICH_SHELL },
    ])

    const result = await fetchSocialProfile(SOURCE, deps)

    expect(fetches).toEqual([SOURCE.url, SOURCE.url])
    expect(delays).toEqual([SOCIAL_RETRY_DELAY_MS])
    expect(result.corpus).toContain('Arabic Restaurant & Cafe')
  })

  it('recovers when a throttle (429) is followed by the public representation', async () => {
    const { deps, fetches } = harness([
      { throw: new PageFetchError('blocked', SOURCE.url, 429) },
      { html: RICH_SHELL },
    ])

    const result = await fetchSocialProfile(SOURCE, deps)
    expect(fetches).toHaveLength(2)
    expect(result.corpus).toContain('Nasi Arab AlShams')
  })

  it('recovers when a thin representation is followed by a full one', async () => {
    const { deps } = harness([{ html: THIN_SHELL }, { html: RICH_SHELL }])

    const result = await fetchSocialProfile(SOURCE, deps)
    expect(result.corpus).toContain('Arabic Restaurant & Cafe')
  })

  it('recovers when a timeout is followed by the public representation', async () => {
    const { deps } = harness([
      { throw: new PageFetchError('timeout', SOURCE.url) },
      { html: RICH_SHELL },
    ])

    const result = await fetchSocialProfile(SOURCE, deps)
    expect(result.corpus).toContain('Nasi Arab AlShams')
  })

  it('throttled on every attempt → SocialThrottledError, never a third fetch', async () => {
    const { deps, fetches } = harness([
      { throw: new PageFetchError('blocked', SOURCE.url, 429) },
      { throw: new PageFetchError('blocked', SOURCE.url, 429) },
    ])

    await expect(fetchSocialProfile(SOURCE, deps)).rejects.toBeInstanceOf(SocialThrottledError)
    expect(fetches).toHaveLength(SOCIAL_FETCH_ATTEMPTS)
  })

  it('walled on every attempt → NotPublicError', async () => {
    const { deps } = harness([
      { throw: new PageFetchError('blocked', SOURCE.url, 403) },
      { html: WALL_SHELL },
    ])

    await expect(fetchSocialProfile(SOURCE, deps)).rejects.toBeInstanceOf(NotPublicError)
  })

  it('a vanished page (404) is terminal — no retry is spent on it', async () => {
    const { deps, fetches, delays } = harness([
      { throw: new PageFetchError('not_found', SOURCE.url, 404) },
    ])

    await expect(fetchSocialProfile(SOURCE, deps)).rejects.toBeInstanceOf(NotPublicError)
    expect(fetches).toHaveLength(1)
    expect(delays).toEqual([])
  })

  it('a non-fetch error (the SSRF guard refusing) passes through with no retry', async () => {
    class GuardRefusal extends Error {}
    const refusal = new GuardRefusal('blocked host')
    const { deps, fetches } = harness([{ throw: refusal }])

    await expect(fetchSocialProfile(SOURCE, deps)).rejects.toBe(refusal)
    expect(fetches).toHaveLength(1)
  })

  it('thin on every attempt → InsufficientContentError, the honest reading', async () => {
    const { deps } = harness([{ html: THIN_SHELL }, { html: THIN_SHELL }])

    await expect(fetchSocialProfile(SOURCE, deps)).rejects.toBeInstanceOf(InsufficientContentError)
  })

  it('a real-but-thin page outranks a wall in the final classification', async () => {
    // The page was genuinely readable once — "not enough information" is
    // more accurate (and more actionable) than "your page is private".
    const { deps } = harness([{ html: THIN_SHELL }, { html: WALL_SHELL }])

    await expect(fetchSocialProfile(SOURCE, deps)).rejects.toBeInstanceOf(InsufficientContentError)
  })

  it('transport failure on every attempt keeps its transport reason', async () => {
    const { deps } = harness([
      { throw: new PageFetchError('timeout', SOURCE.url) },
      { throw: new PageFetchError('timeout', SOURCE.url) },
    ])

    const failure = await fetchSocialProfile(SOURCE, deps).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(SiteUnreachableError)
    expect((failure as SiteUnreachableError).reason).toBe('timeout')
  })

  it('a metadata-only identity pair is sufficient even under 80 characters', async () => {
    // Short Malay bios are real: name + description name the business and
    // its town in well under 80 characters.
    const tiny = `<!DOCTYPE html><html><head>
<title>Kedai Runcit Salmiah</title>
<meta name="description" content="Kedai runcit di Banting." />
</head><body><script>w()</script></body></html>`
    const { deps, fetches } = harness([{ html: tiny }])

    const result = await fetchSocialProfile(SOURCE, deps)
    expect(fetches).toHaveLength(1)
    expect(result.corpus).toContain('Kedai Runcit Salmiah')
    expect(result.corpus).toContain('Kedai runcit di Banting.')
  })
})
