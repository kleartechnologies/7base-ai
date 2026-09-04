import { describe, expect, it } from 'vitest'

import { checkDiscoveryUrl, checkWebsiteUrl, displayHost, displaySource } from './url'

/**
 * This check is the first thing a new user meets, so it has two jobs at once:
 * accept what people actually type, and say one clear sentence when it cannot.
 * It is not a security boundary — the backend re-validates — so these tests
 * are about kindness and clarity, not defence.
 */

const INVALID = 'That doesn’t look like a valid website URL.'

describe('checkWebsiteUrl', () => {
  it('accepts a bare domain, the way an owner would type it', () => {
    expect(checkWebsiteUrl('warungpakdin.com')).toEqual({
      ok: true,
      url: 'https://warungpakdin.com/',
      message: null,
    })
  })

  it('assumes https rather than sending people to an insecure scheme', () => {
    expect(checkWebsiteUrl('www.warungpakdin.com.my').url).toBe('https://www.warungpakdin.com.my/')
  })

  it('keeps http when it was typed deliberately', () => {
    // Plenty of small Malaysian restaurant sites are still plain http.
    expect(checkWebsiteUrl('http://warungpakdin.com').url).toBe('http://warungpakdin.com/')
  })

  it('keeps the path and query, which may be the page worth reading', () => {
    expect(checkWebsiteUrl('warungpakdin.com/menu?lang=ms').url).toBe(
      'https://warungpakdin.com/menu?lang=ms',
    )
  })

  it('forgives surrounding whitespace from a copy and paste', () => {
    expect(checkWebsiteUrl('   warungpakdin.com  ').ok).toBe(true)
  })

  it('drops the fragment, which the server would never see anyway', () => {
    expect(checkWebsiteUrl('warungpakdin.com/menu#specials').url).toBe(
      'https://warungpakdin.com/menu',
    )
  })

  it('strips credentials rather than forwarding them to the backend', () => {
    const result = checkWebsiteUrl('https://user:secret@warungpakdin.com')
    expect(result.ok).toBe(true)
    expect(result.url).not.toContain('secret')
    expect(result.url).toBe('https://warungpakdin.com/')
  })

  it('accepts an internationalised domain', () => {
    expect(checkWebsiteUrl('münchen.de').ok).toBe(true)
  })

  it('gives one plain sentence for an empty field', () => {
    expect(checkWebsiteUrl('')).toEqual({ ok: false, url: '', message: INVALID })
    expect(checkWebsiteUrl('   ').message).toBe(INVALID)
  })

  it('refuses things that are not web addresses', () => {
    for (const input of [
      'hello',
      'warungpakdin',
      'not a website at all',
      'file:///etc/passwd',
      'ftp://warungpakdin.com',
      'javascript:alert(1)',
      'data:text/html,<h1>hi</h1>',
      'mailto:hello@warungpakdin.com',
    ]) {
      expect(checkWebsiteUrl(input), input).toMatchObject({ ok: false, message: INVALID })
    }
  })

  it('refuses an email address pasted into the website field', () => {
    // Guessing at the domain behind an address would analyse a site the owner
    // never actually named.
    expect(checkWebsiteUrl('hello@warungpakdin.com').ok).toBe(false)
  })

  it('refuses a hostname with no public suffix', () => {
    expect(checkWebsiteUrl('http://localhost').ok).toBe(false)
    expect(checkWebsiteUrl('http://intranet').ok).toBe(false)
    expect(checkWebsiteUrl('http://192.168.1.1').ok).toBe(false)
  })

  it('refuses an absurdly long input instead of sending it on', () => {
    expect(checkWebsiteUrl(`https://x.com/${'a'.repeat(3000)}`).ok).toBe(false)
  })

  it('never returns a URL alongside a refusal', () => {
    const result = checkWebsiteUrl('javascript:alert(1)')
    expect(result.url).toBe('')
  })
})

describe('displayHost', () => {
  it('shows the host without the noise', () => {
    expect(displayHost('https://www.warungpakdin.com/menu?x=1')).toBe('warungpakdin.com')
    expect(displayHost('http://warungpakdin.com.my')).toBe('warungpakdin.com.my')
  })

  it('falls back to the raw string rather than throwing in the UI', () => {
    expect(displayHost('not a url')).toBe('not a url')
  })
})

describe('checkDiscoveryUrl', () => {
  it('passes an ordinary website through unchanged', () => {
    const check = checkDiscoveryUrl('warungpakdin.com/menu')
    expect(check).toMatchObject({ ok: true, kind: 'website', url: 'https://warungpakdin.com/menu' })
  })

  it('recognises a Facebook Page on the front-ends people paste', () => {
    for (const input of [
      'facebook.com/warungpakdin',
      'https://www.facebook.com/warungpakdin/',
      'https://m.facebook.com/warungpakdin/about',
      'fb.com/warungpakdin?mibextid=zz',
    ]) {
      expect(checkDiscoveryUrl(input), input).toMatchObject({
        ok: true,
        kind: 'facebook',
        url: 'https://www.facebook.com/warungpakdin/',
      })
    }
  })

  it('keeps the id of an unnamed page and drops the tracking junk', () => {
    expect(checkDiscoveryUrl('https://www.facebook.com/profile.php?id=61550000000000&s=1')).toMatchObject({
      ok: true,
      kind: 'facebook',
      url: 'https://www.facebook.com/profile.php?id=61550000000000',
    })
  })

  it('recognises an Instagram profile and canonicalises the handle', () => {
    for (const input of [
      'instagram.com/warung.pakdin',
      'https://www.instagram.com/Warung.PakDin/?igsh=abc',
      'https://www.instagram.com/warung.pakdin/reels/',
    ]) {
      expect(checkDiscoveryUrl(input), input).toMatchObject({
        ok: true,
        kind: 'instagram',
        url: 'https://www.instagram.com/warung.pakdin/',
      })
    }
  })

  it('refuses post and video links with a helpful sentence', () => {
    for (const input of [
      'https://www.facebook.com/watch?v=123',
      'https://www.facebook.com/reel/9',
      'https://www.facebook.com/groups/foodies',
      'https://www.instagram.com/p/Cxyz/',
      'https://www.instagram.com/reel/Cxyz/',
      'https://www.facebook.com/',
    ]) {
      const check = checkDiscoveryUrl(input)
      expect(check.ok, input).toBe(false)
      expect(check.message).toContain('page or profile')
    }
  })

  it('still refuses what checkWebsiteUrl refuses', () => {
    expect(checkDiscoveryUrl('').ok).toBe(false)
    expect(checkDiscoveryUrl('javascript:alert(1)').ok).toBe(false)
    expect(checkDiscoveryUrl('not a url').ok).toBe(false)
  })
})

describe('displaySource', () => {
  it('shows host plus handle for social pages, host alone for websites', () => {
    expect(displaySource('https://www.facebook.com/warungpakdin/')).toBe('facebook.com/warungpakdin')
    expect(displaySource('https://www.instagram.com/warung.pakdin/')).toBe(
      'instagram.com/warung.pakdin',
    )
    expect(displaySource('https://www.facebook.com/pages/Warung-Pak-Din/123456789')).toBe(
      'facebook.com/Warung-Pak-Din',
    )
    expect(displaySource('https://www.warungpakdin.com/menu')).toBe('warungpakdin.com')
  })
})
