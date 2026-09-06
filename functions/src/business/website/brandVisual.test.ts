import { describe, expect, it } from 'vitest'

import { extractBrandVisual, hasBrandVisual, isBrandLike, normalizeCssColor } from './brandVisual'

/**
 * The extractor is deterministic string work over HTML that was already
 * fetched. These tests pin the two properties Phase 7D.1 promised: it finds
 * exactly what the page states (icon priority, declared colours, named fonts)
 * and it invents nothing — weak or generic evidence comes back empty.
 */

const BASE = 'https://warungmakcik.com/'

function page(head: string, body = ''): string {
  return `<!doctype html><html><head>${head}</head><body>${body}</body></html>`
}

describe('logo candidate priority', () => {
  it('prefers apple-touch-icon over a plain icon and og:image', () => {
    const html = page(`
      <meta property="og:image" content="/social-photo.jpg">
      <link rel="icon" href="/favicon.ico" sizes="32x32">
      <link rel="apple-touch-icon" href="/touch-icon.png" sizes="180x180">
    `)
    expect(extractBrandVisual(BASE, html).logoUrl).toBe('https://warungmakcik.com/touch-icon.png')
  })

  it('prefers a plain icon over shortcut icon and og:image', () => {
    const html = page(`
      <meta property="og:image" content="/social-photo.jpg">
      <link rel="shortcut icon" href="/old-favicon.ico">
      <link rel="icon" href="/icon.png" sizes="192x192">
    `)
    expect(extractBrandVisual(BASE, html).logoUrl).toBe('https://warungmakcik.com/icon.png')
  })

  it('within a tier, the largest declared size wins and SVG beats bitmaps', () => {
    const sized = page(`
      <link rel="icon" href="/icon-16.png" sizes="16x16">
      <link rel="icon" href="/icon-512.png" sizes="512x512">
    `)
    expect(extractBrandVisual(BASE, sized).logoUrl).toBe('https://warungmakcik.com/icon-512.png')

    const svg = page(`
      <link rel="icon" href="/icon-512.png" sizes="512x512">
      <link rel="icon" href="/icon.svg">
    `)
    expect(extractBrandVisual(BASE, svg).logoUrl).toBe('https://warungmakcik.com/icon.svg')
  })

  it('falls back to shortcut icon, then og:image, then nothing', () => {
    const shortcut = page('<link rel="shortcut icon" href="/favicon.ico">')
    expect(extractBrandVisual(BASE, shortcut).logoUrl).toBe('https://warungmakcik.com/favicon.ico')

    const og = page('<meta property="og:image" content="https://cdn.example.com/cover.jpg">')
    expect(extractBrandVisual(BASE, og).logoUrl).toBe('https://cdn.example.com/cover.jpg')

    expect(extractBrandVisual(BASE, page('')).logoUrl).toBeNull()
  })

  it('resolves relative hrefs against the fetched page URL', () => {
    const html = page('<link rel="icon" href="assets/logo.png">')
    expect(extractBrandVisual('https://warungmakcik.com/ms/home', html).logoUrl).toBe(
      'https://warungmakcik.com/ms/assets/logo.png',
    )
  })

  it('never emits data:, javascript: or other non-http URLs', () => {
    const html = page(`
      <link rel="apple-touch-icon" href="data:image/png;base64,AAAA">
      <link rel="icon" href="javascript:alert(1)">
      <meta property="og:image" content="ftp://warungmakcik.com/cover.jpg">
    `)
    expect(extractBrandVisual(BASE, html).logoUrl).toBeNull()
  })
})

describe('colour extraction', () => {
  it('reads theme-color first and expands #RGB shorthand', () => {
    const html = page('<meta name="theme-color" content="#1a5">')
    expect(extractBrandVisual(BASE, html).colors).toEqual([
      { label: 'Theme color', hex: '#11aa55' },
    ])
  })

  it('reads content-before-name attribute order and the tile colour', () => {
    const html = page(`
      <meta content="#1A7F5A" name="theme-color">
      <meta name="msapplication-TileColor" content="#c0392b">
    `)
    expect(extractBrandVisual(BASE, html).colors).toEqual([
      { label: 'Theme color', hex: '#1a7f5a' },
      { label: 'Tile color', hex: '#c0392b' },
    ])
  })

  it('normalises rgb() and keeps rgba() only when mostly opaque', () => {
    const html = page(`
      <meta name="theme-color" content="rgb(26, 127, 90)">
      <style>:root { --brand-accent: rgba(192, 57, 43, 0.9); --brand-glow: rgba(192, 57, 43, 0.2); }</style>
    `)
    expect(extractBrandVisual(BASE, html).colors).toEqual([
      { label: 'Theme color', hex: '#1a7f5a' },
      { label: '--brand-accent', hex: '#c0392b' },
    ])
  })

  it('reads brand-named CSS custom properties from inline style blocks only', () => {
    const html = page(`
      <style>
        :root {
          --brand-primary: #1a7f5a;
          --secondary-color: #C0392B;
          --primary-background: #123456; /* excluded: plumbing suffix */
          --sidebar-width: 240px;
        }
      </style>
    `)
    expect(extractBrandVisual(BASE, html).colors).toEqual([
      { label: '--brand-primary', hex: '#1a7f5a' },
      { label: '--secondary-color', hex: '#c0392b' },
    ])
  })

  it('rejects near-white, near-black, greys and transparent values', () => {
    const html = page(`
      <meta name="theme-color" content="#ffffff">
      <style>:root {
        --brand-dark: #111111;
        --brand-grey: #808080;
        --brand-clear: transparent;
        --brand-real: #1a7f5a;
      }</style>
    `)
    expect(extractBrandVisual(BASE, html).colors).toEqual([
      { label: '--brand-real', hex: '#1a7f5a' },
    ])
  })

  it('dedupes repeats and caps the set at three', () => {
    const html = page(`
      <meta name="theme-color" content="#1a7f5a">
      <style>:root {
        --brand-primary: #1A7F5A;
        --brand-secondary: #c0392b;
        --brand-accent: #f39c12;
        --brand-extra: #8e44ad;
      }</style>
    `)
    const colors = extractBrandVisual(BASE, html).colors
    expect(colors).toHaveLength(3)
    expect(colors.map((c) => c.hex)).toEqual(['#1a7f5a', '#c0392b', '#f39c12'])
  })

  it('finds nothing on a page that declares nothing — no guessing', () => {
    const html = page('', '<p style="color:#1a7f5a">Body colours are not brand declarations</p>')
    expect(extractBrandVisual(BASE, html).colors).toEqual([])
  })
})

describe('normalizeCssColor / isBrandLike', () => {
  it('accepts the four supported syntaxes and lowercases', () => {
    expect(normalizeCssColor('#1A7F5A')).toBe('#1a7f5a')
    expect(normalizeCssColor('#1a5')).toBe('#11aa55')
    expect(normalizeCssColor('rgb(255, 0, 128)')).toBe('#ff0080')
    expect(normalizeCssColor('rgba(255, 0, 128, 1)')).toBe('#ff0080')
  })

  it('rejects everything else rather than approximating', () => {
    for (const bad of ['tomato', 'hsl(120, 50%, 50%)', 'rgb(300,0,0)', 'rgba(0,0,0,0.4)', '', '#12']) {
      expect(normalizeCssColor(bad)).toBeNull()
    }
  })

  it('classifies plumbing colours as not brand-like', () => {
    expect(isBrandLike('#fefefe')).toBe(false)
    expect(isBrandLike('#0a0a0a')).toBe(false)
    expect(isBrandLike('#888888')).toBe(false)
    expect(isBrandLike('#1a7f5a')).toBe(true)
  })
})

describe('font candidate', () => {
  it('maps a Google Fonts css2 link onto the approved list, ignoring weights', () => {
    const html = page(
      '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;700&family=Open+Sans&display=swap">',
    )
    expect(extractBrandVisual(BASE, html).fontFamily).toBe('Poppins')
  })

  it('maps a two-word family from the URL encoding', () => {
    const html = page(
      '<link href="https://fonts.googleapis.com/css2?family=Playfair+Display&display=swap" rel="stylesheet">',
    )
    expect(extractBrandVisual(BASE, html).fontFamily).toBe('Playfair Display')
  })

  it('reads inline font-family declarations case-insensitively', () => {
    const html = page('<style>body { font-family: "MONTSERRAT", sans-serif; }</style>')
    expect(extractBrandVisual(BASE, html).fontFamily).toBe('Montserrat')
  })

  it('returns null for fonts outside the approved list — never invents a mapping', () => {
    const html = page(`
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Raleway&display=swap">
      <style>body { font-family: Raleway, Helvetica, sans-serif; }</style>
    `)
    expect(extractBrandVisual(BASE, html).fontFamily).toBeNull()
  })
})

describe('hasBrandVisual and the empty page', () => {
  it('an empty or brandless page yields an entirely empty result', () => {
    const visual = extractBrandVisual(BASE, page('', '<h1>Warung Mak Cik</h1>'))
    expect(visual).toEqual({ colors: [], logoUrl: null, fontFamily: null })
    expect(hasBrandVisual(visual)).toBe(false)
    expect(hasBrandVisual(null)).toBe(false)
  })

  it('any single found field counts as a visual', () => {
    expect(
      hasBrandVisual(extractBrandVisual(BASE, page('<link rel="icon" href="/f.ico">'))),
    ).toBe(true)
    expect(
      hasBrandVisual(extractBrandVisual(BASE, page('<meta name="theme-color" content="#1a7f5a">'))),
    ).toBe(true)
  })
})
