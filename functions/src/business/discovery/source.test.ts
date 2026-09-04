import { describe, expect, it } from 'vitest'
import { InvalidUrlError } from '../website/url'
import {
  detectDiscoverySource,
  tryDetectDiscoverySource,
  UnsupportedSocialUrlError,
} from './source'

/**
 * Source detection is deterministic on purpose: a hostname is not a judgement
 * call, and no AI request may be spent classifying one. These tests pin both
 * the classification and the canonical URL discovery will actually fetch.
 */

describe('detectDiscoverySource', () => {
  it('treats an ordinary domain as a website, normalised', () => {
    expect(detectDiscoverySource('warungpakdin.com')).toEqual({
      kind: 'website',
      url: 'https://warungpakdin.com/',
    })
    expect(detectDiscoverySource('https://www.example.com/menu')).toEqual({
      kind: 'website',
      url: 'https://www.example.com/menu',
    })
  })

  it('recognises a Facebook Page on every front-end people paste', () => {
    for (const input of [
      'https://www.facebook.com/warungpakdin',
      'https://facebook.com/warungpakdin',
      'https://m.facebook.com/warungpakdin',
      'https://mbasic.facebook.com/warungpakdin',
      'https://web.facebook.com/warungpakdin',
      'https://fb.com/warungpakdin',
      'https://www.fb.com/warungpakdin',
      'facebook.com/warungpakdin', // no scheme
      'https://www.facebook.com/warungpakdin/', // trailing slash
      'https://www.facebook.com/warungpakdin?mibextid=xyz#top', // tracking junk
    ]) {
      expect(detectDiscoverySource(input), input).toEqual({
        kind: 'facebook',
        url: 'https://www.facebook.com/warungpakdin/',
      })
    }
  })

  it('keeps the case of a Facebook page name but not its host', () => {
    expect(detectDiscoverySource('https://Facebook.com/WarungPakDin')).toEqual({
      kind: 'facebook',
      url: 'https://www.facebook.com/WarungPakDin/',
    })
  })

  it('truncates page sub-views back to the page itself', () => {
    for (const input of [
      'https://www.facebook.com/warungpakdin/about',
      'https://www.facebook.com/warungpakdin/menu/',
      'https://www.facebook.com/warungpakdin/posts/12345',
      'https://m.facebook.com/warungpakdin/reviews',
    ]) {
      expect(detectDiscoverySource(input), input).toEqual({
        kind: 'facebook',
        url: 'https://www.facebook.com/warungpakdin/',
      })
    }
  })

  it('supports unnamed pages via profile.php, keeping only the id', () => {
    expect(
      detectDiscoverySource('https://www.facebook.com/profile.php?id=61550000000000&mibextid=zz'),
    ).toEqual({
      kind: 'facebook',
      url: 'https://www.facebook.com/profile.php?id=61550000000000',
    })
  })

  it('refuses profile.php without a plausible numeric id', () => {
    for (const input of [
      'https://www.facebook.com/profile.php',
      'https://www.facebook.com/profile.php?id=abc',
      'https://www.facebook.com/profile.php?id=12',
    ]) {
      expect(() => detectDiscoverySource(input), input).toThrow(UnsupportedSocialUrlError)
    }
  })

  it('supports legacy /pages/ URLs', () => {
    expect(
      detectDiscoverySource('https://www.facebook.com/pages/Warung-Pak-Din/123456789/about'),
    ).toEqual({
      kind: 'facebook',
      url: 'https://www.facebook.com/pages/Warung-Pak-Din/123456789',
    })
    expect(() => detectDiscoverySource('https://www.facebook.com/pages/only-a-slug')).toThrow(
      UnsupportedSocialUrlError,
    )
  })

  it('refuses Facebook links that are not a page', () => {
    for (const input of [
      'https://www.facebook.com/', // no page named
      'https://www.facebook.com/watch?v=123',
      'https://www.facebook.com/reel/98765',
      'https://www.facebook.com/groups/kualalumpurfoodies',
      'https://www.facebook.com/events/1234567',
      'https://www.facebook.com/marketplace/item/1',
      'https://www.facebook.com/share/p/abc123/',
      'https://www.facebook.com/photo.php?fbid=1',
      'https://www.facebook.com/login.php',
      'https://www.facebook.com/hashtag/nasilemak',
    ]) {
      expect(() => detectDiscoverySource(input), input).toThrow(UnsupportedSocialUrlError)
    }
  })

  it('recognises an Instagram profile and canonicalises the handle', () => {
    for (const input of [
      'https://www.instagram.com/warung.pakdin',
      'https://instagram.com/warung.pakdin/',
      'https://m.instagram.com/warung.pakdin',
      'instagram.com/warung.pakdin',
      'https://www.instagram.com/warung.pakdin?igsh=abc#top',
      'https://www.instagram.com/Warung.PakDin', // handles are case-insensitive
      'https://www.instagram.com/warung.pakdin/reels/', // profile tab
    ]) {
      expect(detectDiscoverySource(input), input).toEqual({
        kind: 'instagram',
        url: 'https://www.instagram.com/warung.pakdin/',
      })
    }
  })

  it('refuses Instagram links that are not a profile', () => {
    for (const input of [
      'https://www.instagram.com/', // no handle
      'https://www.instagram.com/p/Cxyz123/', // a post
      'https://www.instagram.com/reel/Cxyz123/',
      'https://www.instagram.com/tv/Cxyz123/',
      'https://www.instagram.com/stories/somebody/123/',
      'https://www.instagram.com/explore/tags/nasilemak/',
      'https://www.instagram.com/accounts/login/',
      'https://www.instagram.com/this-handle-is-not-valid', // hyphens cannot appear in handles
    ]) {
      expect(() => detectDiscoverySource(input), input).toThrow(UnsupportedSocialUrlError)
    }
  })

  it('gives every social URL the same SSRF scrutiny as a website URL', () => {
    // The facebook.com shape earns no bypass: validation runs before the
    // hostname is even looked at.
    for (const input of [
      'http://127.0.0.1/warungpakdin',
      'http://localhost/warungpakdin',
      'http://[::ffff:127.0.0.1]/warungpakdin',
      'https://user:pass@facebook.com/warungpakdin',
      'https://facebook.com:8443/warungpakdin',
      'javascript:alert(1)',
    ]) {
      expect(() => detectDiscoverySource(input), input).toThrow(InvalidUrlError)
    }
  })

  it('refuses malformed input the same way the website path always has', () => {
    expect(() => detectDiscoverySource('')).toThrow(InvalidUrlError)
    expect(() => detectDiscoverySource('ha ha not a url')).toThrow(InvalidUrlError)
  })
})

describe('tryDetectDiscoverySource', () => {
  it('answers without throwing', () => {
    expect(tryDetectDiscoverySource('instagram.com/warungpakdin')?.kind).toBe('instagram')
    expect(tryDetectDiscoverySource('http://localhost/')).toBeNull()
    expect(tryDetectDiscoverySource('https://www.facebook.com/watch?v=1')).toBeNull()
  })
})
