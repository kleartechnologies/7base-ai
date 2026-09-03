import { describe, expect, it } from 'vitest'
import {
  InvalidUrlError,
  isBlockedIpAddress,
  isBlockedIpv4,
  isBlockedIpv6,
  isSameSite,
  isValidWebsiteUrl,
  normalizeWebsiteUrl,
} from './url'

/**
 * The URL a user types is the one piece of attacker-controlled input that ends
 * up in an outbound request, so these tests are the first line of the SSRF
 * defence rather than a formatting check.
 */

describe('normalizeWebsiteUrl', () => {
  it('accepts what people actually type', () => {
    expect(normalizeWebsiteUrl('warungpakdin.com')).toBe('https://warungpakdin.com/')
    expect(normalizeWebsiteUrl('  www.warungpakdin.com/menu  ')).toBe(
      'https://www.warungpakdin.com/menu',
    )
    expect(normalizeWebsiteUrl('HTTPS://Example.COM/')).toBe('https://example.com/')
    expect(normalizeWebsiteUrl('http://example.com')).toBe('http://example.com/')
  })

  it('strips the quotes and brackets people paste along with a URL', () => {
    expect(normalizeWebsiteUrl('<https://example.com>')).toBe('https://example.com/')
    expect(normalizeWebsiteUrl('"https://example.com"')).toBe('https://example.com/')
  })

  it('drops the fragment and the redundant default port', () => {
    expect(normalizeWebsiteUrl('https://example.com:443/menu#specials')).toBe(
      'https://example.com/menu',
    )
  })

  it('keeps the trailing-dot form from being a second identity for a host', () => {
    expect(normalizeWebsiteUrl('https://example.com./')).toBe('https://example.com/')
  })

  it('refuses schemes that are not web pages', () => {
    for (const input of ['file:///etc/passwd', 'ftp://example.com', 'javascript:alert(1)', 'data:text/html,hi']) {
      expect(() => normalizeWebsiteUrl(input)).toThrow(InvalidUrlError)
    }
  })

  it('refuses credentials embedded in the URL', () => {
    expect(() => normalizeWebsiteUrl('https://user:pass@example.com')).toThrow(InvalidUrlError)
  })

  it('refuses ports other than the web ports', () => {
    expect(() => normalizeWebsiteUrl('https://example.com:22/')).toThrow(InvalidUrlError)
    expect(() => normalizeWebsiteUrl('http://example.com:8080/')).toThrow(InvalidUrlError)
  })

  it('refuses loopback and internal names', () => {
    for (const input of [
      'http://localhost/',
      'http://localhost:80/',
      'http://printer.local/',
      'http://db.internal/',
      'http://metadata.google.internal/',
      'http://nas.home.arpa/',
      'http://intranet/',
    ]) {
      expect(() => normalizeWebsiteUrl(input)).toThrow(InvalidUrlError)
    }
  })

  it('refuses IP literals outright, so DNS is never bypassed', () => {
    for (const input of [
      'http://127.0.0.1/',
      'http://169.254.169.254/latest/meta-data/',
      'http://10.0.0.5/',
      'http://192.168.1.1/',
      'http://[::1]/',
      'http://8.8.8.8/',
    ]) {
      expect(() => normalizeWebsiteUrl(input)).toThrow(InvalidUrlError)
    }
  })

  it('refuses empty and oversized input', () => {
    expect(() => normalizeWebsiteUrl('   ')).toThrow(InvalidUrlError)
    expect(() => normalizeWebsiteUrl(`https://example.com/${'a'.repeat(3000)}`)).toThrow(
      InvalidUrlError,
    )
  })
})

describe('isValidWebsiteUrl', () => {
  it('answers without throwing', () => {
    expect(isValidWebsiteUrl('example.com')).toBe(true)
    expect(isValidWebsiteUrl('http://localhost')).toBe(false)
  })
})

describe('private address detection', () => {
  it('blocks every private and special-use IPv4 range', () => {
    for (const address of [
      '0.0.0.0',
      '10.1.2.3',
      '100.64.0.1',
      '127.0.0.1',
      '169.254.169.254',
      '172.16.0.1',
      '172.31.255.255',
      '192.0.0.1',
      '192.168.0.1',
      '198.18.0.1',
      '224.0.0.1',
      '255.255.255.255',
    ]) {
      expect(isBlockedIpv4(address), address).toBe(true)
    }
  })

  it('allows ordinary public addresses', () => {
    for (const address of ['8.8.8.8', '1.1.1.1', '203.0.114.5', '172.32.0.1', '11.0.0.1']) {
      expect(isBlockedIpv4(address), address).toBe(false)
    }
  })

  it('blocks loopback, link-local, unique-local and mapped IPv6', () => {
    for (const address of ['::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'ff02::1', '::ffff:127.0.0.1']) {
      expect(isBlockedIpv6(address), address).toBe(true)
    }
  })

  it('allows a public IPv6 address', () => {
    expect(isBlockedIpv6('2001:4860:4860::8888')).toBe(false)
  })

  it('refuses rather than guesses when it cannot classify the input', () => {
    expect(isBlockedIpAddress('not-an-address')).toBe(true)
    expect(isBlockedIpAddress('')).toBe(true)
  })
})

describe('isSameSite', () => {
  it('keeps a crawl inside the domain it was given', () => {
    expect(isSameSite('https://example.com/', 'https://example.com/menu')).toBe(true)
    expect(isSameSite('https://example.com/', 'https://www.example.com/menu')).toBe(true)
    // Subdomains are treated as a different site on purpose: a shop or blog
    // subdomain is often someone else's platform, and the crawl was only
    // authorised for the host the owner gave.
    expect(isSameSite('https://www.example.com/', 'https://shop.example.com/')).toBe(false)
    expect(isSameSite('https://example.com/', 'https://evil.com/')).toBe(false)
    expect(isSameSite('https://example.com/', 'https://example.com.evil.com/')).toBe(false)
  })
})
