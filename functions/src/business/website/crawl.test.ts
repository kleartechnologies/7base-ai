import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Crawl-level tests.
 *
 * The unit under test is the loop's bookkeeping, not the network: DNS and
 * `fetch` are both stubbed so the cases below are deterministic.
 *
 * The case that matters most here is the redirect one. Ranking canonicalises
 * every candidate (it strips trailing slashes and index files), so the URL the
 * crawler requests routinely differs from the URL that finally answers. A
 * dedupe check that cannot tell "this redirected onto a page I already read"
 * from "this redirected onto itself" silently drops the menu — the single most
 * valuable page on a restaurant site — and reports no failure while doing it.
 */

// `vi.mock` is hoisted above the imports, so the static import below still
// receives the stubbed resolver.
vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]),
}))

import { crawlSite } from './crawl'

function html(body: string): Response {
  return new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } })
}

function redirect(location: string): Response {
  return new Response(null, { status: 301, headers: { location } })
}

const HOME = `<html><head><title>Home</title></head><body>
  <h1>Warung Test</h1>
  <p>${'Nasi lemak and teh tarik, served all day in Bangi. '.repeat(12)}</p>
  <a href="/menu/">Our menu</a>
  <a href="/about-us/">About us</a>
</body></html>`

const MENU = `<html><head><title>Menu</title></head><body>
  <h1>Menu</h1>
  <p>Nasi Lemak Ayam RM12.90</p>
  <p>${'Teh tarik and roti canai available every day. '.repeat(12)}</p>
</body></html>`

const ABOUT = `<html><head><title>About</title></head><body>
  <h1>About us</h1>
  <p>${'We started in 2015 as a small family stall in Bangi. '.repeat(12)}</p>
</body></html>`

let routes: Map<string, () => Response>

beforeEach(() => {
  routes = new Map()
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
    const url = String(input)
    const handler = routes.get(url)
    if (handler) return handler()
    return new Response('not found', { status: 404 })
  }))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('crawlSite', () => {
  it('keeps a page that redirects from the canonicalised candidate onto itself', async () => {
    routes.set('https://warungtest.com/robots.txt', () => new Response('not found', { status: 404 }))
    routes.set('https://warungtest.com/', () => html(HOME))
    // Ranking hands back "/menu" (canonicalised); the site answers on "/menu/".
    routes.set('https://warungtest.com/menu', () => redirect('/menu/'))
    routes.set('https://warungtest.com/menu/', () => html(MENU))
    routes.set('https://warungtest.com/about-us', () => redirect('/about-us/'))
    routes.set('https://warungtest.com/about-us/', () => html(ABOUT))

    const result = await crawlSite('https://warungtest.com')

    expect(result.failures).toEqual([])
    expect(result.pages.map((page) => page.url)).toEqual([
      'https://warungtest.com/',
      'https://warungtest.com/menu/',
      'https://warungtest.com/about-us/',
    ])
  })

  it('still drops a page that redirects onto one already read', async () => {
    routes.set('https://warungtest.com/robots.txt', () => new Response('not found', { status: 404 }))
    routes.set('https://warungtest.com/', () => html(HOME))
    routes.set('https://warungtest.com/menu', () => html(MENU))
    // "About" is really the homepage under another name.
    routes.set('https://warungtest.com/about-us', () => redirect('/'))

    const result = await crawlSite('https://warungtest.com')

    expect(result.pages.map((page) => page.url)).toEqual([
      'https://warungtest.com/',
      'https://warungtest.com/menu',
    ])
    expect(result.failures).toEqual([])
  })

  it('records a failure rather than dropping a page silently', async () => {
    routes.set('https://warungtest.com/robots.txt', () => new Response('not found', { status: 404 }))
    routes.set('https://warungtest.com/', () => html(HOME))
    routes.set('https://warungtest.com/menu', () => html(MENU))
    routes.set('https://warungtest.com/about-us', () => new Response('gone', { status: 404 }))

    const result = await crawlSite('https://warungtest.com')

    expect(result.pages).toHaveLength(2)
    expect(result.failures).toEqual([
      { url: 'https://warungtest.com/about-us', reason: 'not_found' },
    ])
  })
})
