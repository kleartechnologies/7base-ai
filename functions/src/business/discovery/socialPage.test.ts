import { describe, expect, it } from 'vitest'
import type { ExtractedPage } from '../website/extract'
import {
  buildSocialCorpus,
  isSocialContentSufficient,
  isSocialLoginWall,
  MIN_SOCIAL_TEXT_LENGTH,
} from './socialPage'

function page(overrides: Partial<ExtractedPage> = {}): ExtractedPage {
  return {
    url: 'https://www.facebook.com/warungpakdin/',
    title: 'Warung Pak Din | Kuala Lumpur',
    ogTitle: null,
    metaDescription: 'Warung Pak Din. 4,213 likes. Authentic nasi lemak since 1998.',
    headings: ['Warung Pak Din'],
    textBlocks: ['Open daily 7am-3pm', 'Jalan Ampang, Kuala Lumpur'],
    priceLines: ['Nasi lemak ayam RM 8.50'],
    links: [],
    images: [],
    emails: [],
    phones: [],
    socialLinks: [],
    structuredData: [],
    textLength: 400,
    ...overrides,
  }
}

describe('isSocialLoginWall', () => {
  it('never flags a website fetch', () => {
    expect(isSocialLoginWall('website', 'https://example.com/login', page({ title: 'Log in' }))).toBe(
      false,
    )
  })

  it('flags a redirect to a login path, whatever the page says', () => {
    for (const finalUrl of [
      'https://www.facebook.com/login/?next=%2Fwarungpakdin',
      'https://www.facebook.com/login.php?next=x',
      'https://www.instagram.com/accounts/login/?next=%2Fwarungpakdin%2F',
      'https://www.facebook.com/checkpoint/?next=x',
    ]) {
      expect(isSocialLoginWall('facebook', finalUrl, page()), finalUrl).toBe(true)
    }
  })

  it('flags login-wall and unavailable-content titles', () => {
    const url = 'https://www.facebook.com/warungpakdin/'
    for (const title of [
      'Facebook - log in or sign up',
      'Log into Facebook',
      'Log in to Facebook',
      'Login • Instagram',
      'Instagram',
      'Facebook',
      'Page not found',
      "This content isn't available right now",
    ]) {
      expect(isSocialLoginWall('facebook', url, page({ title })), title).toBe(true)
    }
  })

  it('flags a titleless script-shell render with nothing to read', () => {
    expect(
      isSocialLoginWall('instagram', 'https://www.instagram.com/warungpakdin/', {
        title: null,
        ogTitle: null,
        textLength: MIN_SOCIAL_TEXT_LENGTH - 1,
      }),
    ).toBe(true)
  })

  it('a shell that names its subject only in og:title is not a wall', () => {
    expect(
      isSocialLoginWall('facebook', 'https://www.facebook.com/warungpakdin/', {
        title: null,
        ogTitle: 'Warung Pak Din | Kuala Lumpur',
        textLength: 0,
      }),
    ).toBe(false)
  })

  it('a wall title in og:title is still a wall', () => {
    expect(
      isSocialLoginWall('facebook', 'https://www.facebook.com/warungpakdin/', {
        title: null,
        ogTitle: 'Facebook - log in or sign up',
        textLength: 500,
      }),
    ).toBe(true)
  })

  it('passes a page that actually shows the business', () => {
    expect(isSocialLoginWall('facebook', 'https://www.facebook.com/warungpakdin/', page())).toBe(
      false,
    )
    // A real page title that merely CONTAINS the platform name is fine.
    expect(
      isSocialLoginWall(
        'instagram',
        'https://www.instagram.com/warungpakdin/',
        page({ title: 'Warung Pak Din (@warungpakdin) • Instagram photos' }),
      ),
    ).toBe(false)
  })
})

describe('buildSocialCorpus', () => {
  it('flattens the page into labelled lines with a real text length', () => {
    const result = buildSocialCorpus('facebook', page())

    expect(result.corpus).toContain('Facebook Page title: Warung Pak Din | Kuala Lumpur')
    expect(result.corpus).toContain('Profile description: Warung Pak Din. 4,213 likes.')
    expect(result.corpus).toContain('Jalan Ampang, Kuala Lumpur')
    expect(result.corpus).toContain('Price line: Nasi lemak ayam RM 8.50')
    expect(result.textLength).toBeGreaterThan(MIN_SOCIAL_TEXT_LENGTH)
  })

  it('labels an Instagram profile as one', () => {
    const result = buildSocialCorpus('instagram', page())
    expect(result.corpus).toContain('Instagram profile title:')
  })

  it('reports honestly when the platform gave almost nothing', () => {
    const empty = buildSocialCorpus(
      'instagram',
      page({
        title: null,
        metaDescription: null,
        headings: [],
        textBlocks: [],
        priceLines: [],
        structuredData: [],
        textLength: 0,
      }),
    )
    expect(empty.corpus).toBe('')
    expect(empty.textLength).toBe(0)
  })

  it('keeps JSON-LD and skips what cannot be serialised', () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular

    const result = buildSocialCorpus(
      'facebook',
      page({ structuredData: [{ '@type': 'Restaurant', name: 'Warung Pak Din' }, circular] }),
    )
    expect(result.corpus).toContain('Structured data: {"@type":"Restaurant"')
  })

  it('deduplicates repeated lines and caps the corpus size', () => {
    const result = buildSocialCorpus(
      'facebook',
      page({ textBlocks: Array.from({ length: 500 }, (_, i) => `Block ${i % 3} ${'x'.repeat(40)}`) }),
    )
    expect(result.corpus.length).toBeLessThanOrEqual(8_000)
    const occurrences = result.corpus.split('Block 1 ').length - 1
    expect(occurrences).toBe(1)
  })

  it('falls back to og:title when the title tag is missing', () => {
    const result = buildSocialCorpus(
      'facebook',
      page({ title: null, ogTitle: 'Warung Pak Din | Kuala Lumpur' }),
    )
    expect(result.corpus).toContain('Facebook Page title: Warung Pak Din | Kuala Lumpur')
    expect(result.hasIdentity).toBe(true)
  })

  it('reports the identity pair only when both title and description exist', () => {
    expect(buildSocialCorpus('facebook', page()).hasIdentity).toBe(true)
    expect(buildSocialCorpus('facebook', page({ metaDescription: null })).hasIdentity).toBe(false)
    expect(
      buildSocialCorpus('facebook', page({ title: null, ogTitle: null })).hasIdentity,
    ).toBe(false)
    expect(buildSocialCorpus('facebook', page({ metaDescription: '   ' })).hasIdentity).toBe(false)
  })

  it('surfaces contact details and the business website, not platform links', () => {
    const result = buildSocialCorpus(
      'facebook',
      page({
        emails: ['hello@warungpakdin.com'],
        phones: ['+60123456789'],
        links: [
          { url: 'https://warungpakdin.com/', text: 'Website' },
          { url: 'https://www.facebook.com/warungpakdin/about', text: 'About' },
          { url: 'https://scontent.fbcdn.net/photo.jpg', text: '' },
          { url: 'not a url', text: '' },
        ],
      }),
    )
    expect(result.signals.emails).toEqual(['hello@warungpakdin.com'])
    expect(result.signals.phones).toEqual(['+60123456789'])
    expect(result.signals.outboundLinks).toEqual(['https://warungpakdin.com/'])
  })
})

describe('isSocialContentSufficient', () => {
  it('passes on the raw floor alone, as before', () => {
    const social = buildSocialCorpus('facebook', page({ metaDescription: null }))
    expect(social.textLength).toBeGreaterThanOrEqual(MIN_SOCIAL_TEXT_LENGTH)
    expect(isSocialContentSufficient(social)).toBe(true)
  })

  it('passes a short metadata-only page when the identity pair is present', () => {
    // A real pattern: short Malay bio, script-only body. Name + description
    // carry the business, its category and its town in under 80 characters.
    const social = buildSocialCorpus(
      'facebook',
      page({
        title: 'Kedai Runcit Salmiah',
        metaDescription: 'Kedai runcit di Banting.',
        headings: [],
        textBlocks: [],
        priceLines: [],
        structuredData: [],
      }),
    )
    expect(social.textLength).toBeLessThan(MIN_SOCIAL_TEXT_LENGTH)
    expect(isSocialContentSufficient(social)).toBe(true)
  })

  it('still fails a page with neither the floor nor the identity pair', () => {
    const social = buildSocialCorpus(
      'facebook',
      page({
        title: 'Kedai Salmiah | Banting',
        metaDescription: null,
        headings: [],
        textBlocks: [],
        priceLines: [],
        structuredData: [],
      }),
    )
    expect(social.hasIdentity).toBe(false)
    expect(isSocialContentSufficient(social)).toBe(false)
  })
})
