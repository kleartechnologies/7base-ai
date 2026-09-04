import { describe, expect, it } from 'vitest'
import { extractPage } from './extract'

/**
 * Extraction has to hand the model a business, not a web page. These tests
 * pin the two things that decide whether that works: nothing executable or
 * decorative survives, and the parts a restaurant's site actually carries —
 * dish names, prices, contact details — do.
 */

const PAGE = `
<!doctype html>
<html>
  <head>
    <title>Warung Pak Din — Home</title>
    <meta name="description" content="Home-style Malay food in Bangsar." />
    <style>.hero { color: red }</style>
    <script>window.secret = 'do-not-read-me'; alert('nope')</script>
    <script type="application/ld+json">
      {"@type":"Restaurant","name":"Warung Pak Din","servesCuisine":"Malay"}
    </script>
  </head>
  <body>
    <nav><a href="/menu">Menu</a><a href="/about">About us</a><a href="/cart">Cart</a></nav>
    <button>Skip to main content</button>
    <div class="cookie-banner">We use cookies to improve your experience. Accept all</div>
    <h1>Warung Pak Din</h1>
    <h2>Our menu</h2>
    <p>Serving Bangsar since 2011. Halal &amp; home-style, cooked fresh daily.</p>
    <ul>
      <li>Nasi lemak ayam berempah — RM12.90</li>
      <li>Rendang daging set — RM18.00</li>
    </ul>
    <p>Call us on 03-2201 1188 or email hello@warungpakdin.com</p>
    <a href="https://www.instagram.com/warungpakdin">Instagram</a>
    <img src="/img/nasi-lemak.jpg" alt="Nasi lemak" />
    <noscript>Please enable JavaScript</noscript>
    <footer>© 2026 Warung Pak Din. All rights reserved. Powered by Wix.</footer>
  </body>
</html>
`

const page = extractPage('https://warungpakdin.com/', PAGE)
const allText = [...page.textBlocks, ...page.priceLines, ...page.headings].join(' | ')

describe('extractPage', () => {
  it('reads the page identity', () => {
    expect(page.title).toBe('Warung Pak Din — Home')
    expect(page.metaDescription).toBe('Home-style Malay food in Bangsar.')
    expect(page.headings).toContain('Warung Pak Din')
    expect(page.headings).toContain('Our menu')
  })

  it('reads og:title separately from the title tag', () => {
    const shell = extractPage(
      'https://example.com/',
      `<html><head><meta property="og:title" content="Warung Pak Din &amp; Sons" /></head><body></body></html>`,
    )
    expect(shell.title).toBeNull()
    expect(shell.ogTitle).toBe('Warung Pak Din & Sons')
  })

  it('never carries script or style content through', () => {
    expect(allText).not.toContain('do-not-read-me')
    expect(allText).not.toContain('alert(')
    expect(allText).not.toContain('color: red')
    expect(allText).not.toContain('Please enable JavaScript')
  })

  it('keeps menu lines with their prices', () => {
    expect(page.priceLines.some((line) => line.includes('Nasi lemak ayam berempah'))).toBe(true)
    expect(page.priceLines.some((line) => line.includes('RM18.00'))).toBe(true)
  })

  it('decodes entities rather than passing markup through', () => {
    expect(allText).toContain('Halal & home-style')
    expect(allText).not.toContain('&amp;')
    expect(allText).not.toContain('<p>')
  })

  it('drops cookie banners, skip links and footer boilerplate', () => {
    expect(allText).not.toMatch(/we use cookies/i)
    expect(allText).not.toMatch(/skip to main content/i)
    expect(allText).not.toMatch(/all rights reserved/i)
    expect(allText).not.toMatch(/powered by/i)
  })

  it('collects contact details and social profiles', () => {
    expect(page.emails).toContain('hello@warungpakdin.com')
    expect(page.phones.some((phone) => phone.includes('2201'))).toBe(true)
    expect(page.socialLinks).toContain('https://www.instagram.com/warungpakdin')
  })

  it('resolves links against the page and keeps structured data', () => {
    const urls = page.links.map((link) => link.url)
    expect(urls).toContain('https://warungpakdin.com/menu')
    expect(urls).toContain('https://warungpakdin.com/about')
    expect(page.structuredData).toHaveLength(1)
    expect((page.structuredData[0] as { name: string }).name).toBe('Warung Pak Din')
  })

  it('resolves image sources absolutely', () => {
    expect(page.images).toContain('https://warungpakdin.com/img/nasi-lemak.jpg')
  })

  it('survives malformed markup instead of throwing', () => {
    const broken = extractPage('https://example.com/', '<html><body><h1>Hi<p>unclosed')
    expect(broken.textLength).toBeGreaterThan(0)
  })

  it('reports no content for an empty document', () => {
    const empty = extractPage('https://example.com/', '<html><body></body></html>')
    expect(empty.textLength).toBe(0)
    expect(empty.textBlocks).toEqual([])
  })
})

/**
 * JSON-LD is the business describing itself in a schema, so a number published
 * there is at least as reliable as one printed in the footer — and on real
 * sites (secretrecipe.com.my, for one) it is the *only* place the number
 * appears, because the header dials out through a script rather than a
 * `tel:` link.
 */
describe('extractPage — telephone in JSON-LD', () => {
  const ld = (payload: unknown, body = '<p>Hello</p>') =>
    extractPage(
      'https://example.com/',
      `<html><head><script type="application/ld+json">${JSON.stringify(payload)}</script></head><body>${body}</body></html>`,
    )

  it('reads telephone off a top-level LocalBusiness node', () => {
    const page = ld({
      '@context': 'https://schema.org',
      '@type': ['Organization', 'LocalBusiness'],
      name: 'Secret Recipe Cakes & Café Sdn Bhd',
      telephone: '+603 7490 2063',
    })
    expect(page.phones).toContain('+603 7490 2063')
  })

  it('finds a telephone nested inside @graph', () => {
    const page = ld({
      '@context': 'https://schema.org',
      '@graph': [
        { '@type': 'WebSite', name: 'Site' },
        { '@type': 'Restaurant', name: 'Warung', telephone: '+60 3-1234 5678' },
      ],
    })
    expect(page.phones).toContain('+60 3-1234 5678')
  })

  it('collects a telephone from every branch of a chain', () => {
    const page = ld([
      { '@type': 'Restaurant', name: 'Outlet A', telephone: '03-1111 2222' },
      { '@type': 'Restaurant', name: 'Outlet B', telephone: '03-3333 4444' },
    ])
    expect(page.phones).toEqual(expect.arrayContaining(['03-1111 2222', '03-3333 4444']))
  })

  it('strips a tel: prefix and keeps the printed formatting', () => {
    const page = ld({ '@type': 'Restaurant', telephone: 'tel:+60312345678' })
    expect(page.phones).toContain('+60312345678')
  })

  it('prefers a tel: link but still records the JSON-LD number', () => {
    const page = extractPage(
      'https://example.com/',
      `<html><head><script type="application/ld+json">${JSON.stringify({
        '@type': 'Restaurant',
        telephone: '+603 7490 2063',
      })}</script></head><body><a href="tel:+60374902063">Call</a></body></html>`,
    )
    expect(page.phones[0]).toBe('+60374902063')
    expect(page.phones).toContain('+603 7490 2063')
  })

  it('ignores telephone values that are not numbers', () => {
    const page = ld({ '@type': 'Restaurant', telephone: 'Call us today!' })
    expect(page.phones).toEqual([])
  })

  it('ignores an empty telephone', () => {
    const page = ld({ '@type': 'Restaurant', telephone: '' })
    expect(page.phones).toEqual([])
  })

  it('does not treat other JSON-LD fields as phone numbers', () => {
    const page = ld({
      '@type': 'Restaurant',
      name: 'Warung',
      priceRange: 'RM10 - RM30',
      postalCode: '43650',
      faxNumber: '+603 7490 9999',
    })
    expect(page.phones).toEqual([])
  })

  it('survives malformed JSON-LD without losing the page', () => {
    const page = extractPage(
      'https://example.com/',
      '<html><head><script type="application/ld+json">{not json}</script></head><body><p>Nasi lemak here</p></body></html>',
    )
    expect(page.phones).toEqual([])
    expect(page.textLength).toBeGreaterThan(0)
  })
})
