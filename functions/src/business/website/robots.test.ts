import { describe, expect, it } from 'vitest'

import { isAllowedByRobots, parseRobots } from './robots'

/**
 * MARKA fetches sites automatically, from a server, without the site owner
 * choosing the moment — which makes it a bot. These tests cover the two ways
 * that goes wrong: ignoring a rule that applies, and honouring a rule written
 * for somebody else's crawler.
 */

describe('parseRobots', () => {
  it('reads the wildcard group', () => {
    expect(
      parseRobots(['User-agent: *', 'Disallow: /admin', 'Disallow: /cart'].join('\n')),
    ).toEqual({ disallowed: ['/admin', '/cart'] })
  })

  it('prefers rules written for MARKA over the wildcard group', () => {
    const rules = parseRobots(
      [
        'User-agent: *',
        'Disallow: /',
        '',
        'User-agent: markabot',
        'Disallow: /checkout',
      ].join('\n'),
    )
    expect(rules.disallowed).toEqual(['/checkout'])
  })

  it('ignores rules addressed to other crawlers', () => {
    const rules = parseRobots(
      ['User-agent: GPTBot', 'Disallow: /', '', 'User-agent: *', 'Disallow: /tmp'].join('\n'),
    )
    expect(rules.disallowed).toEqual(['/tmp'])
  })

  it('obeys a MARKA-specific block even when it is empty of paths', () => {
    // "User-agent: markabot" with no Disallow means MARKA has its own, empty
    // group — it must not fall back to the stricter wildcard rules.
    const rules = parseRobots(
      ['User-agent: *', 'Disallow: /', '', 'User-agent: markabot', 'Allow: /'].join('\n'),
    )
    expect(rules.disallowed).toEqual([])
  })

  it('matches the agent name case-insensitively', () => {
    expect(parseRobots('User-Agent: MarkaBot\nDisallow: /x').disallowed).toEqual(['/x'])
  })

  it('strips comments and tolerates odd spacing', () => {
    const rules = parseRobots(
      ['  User-agent:*   # everyone', 'Disallow:  /private   # keep out', 'Disallow:'].join('\n'),
    )
    expect(rules.disallowed).toEqual(['/private'])
  })

  it('skips lines that are not field-value pairs', () => {
    expect(parseRobots('User-agent: *\nthis is not a directive\nDisallow: /a').disallowed).toEqual([
      '/a',
    ])
  })

  it('treats an empty or junk file as "no rules"', () => {
    expect(parseRobots('')).toEqual({ disallowed: [] })
    expect(parseRobots('<!doctype html><h1>Not found</h1>')).toEqual({ disallowed: [] })
  })

  it('ignores a Disallow that appears before any User-agent line', () => {
    expect(parseRobots('Disallow: /orphan').disallowed).toEqual([])
  })
})

describe('isAllowedByRobots', () => {
  const rules = parseRobots('User-agent: *\nDisallow: /admin\nDisallow: /*.pdf$')

  it('allows a page no rule mentions', () => {
    expect(isAllowedByRobots(rules, 'https://example.com/menu')).toBe(true)
  })

  it('blocks a disallowed prefix and everything under it', () => {
    expect(isAllowedByRobots(rules, 'https://example.com/admin')).toBe(false)
    expect(isAllowedByRobots(rules, 'https://example.com/admin/login')).toBe(false)
  })

  it('applies a wildcard rule to what it actually matches, not the whole site', () => {
    // "/*.pdf$" is one of the most common lines in a real robots.txt. Reading
    // it as a "/" block would mean MARKA crawls nothing at all.
    expect(isAllowedByRobots(rules, 'https://example.com/menus/lunch.pdf')).toBe(false)
    expect(isAllowedByRobots(rules, 'https://example.com/menus/lunch.pdf.html')).toBe(true)
    expect(isAllowedByRobots(rules, 'https://example.com/about')).toBe(true)
  })

  it('honours a trailing $ as an end anchor', () => {
    const anchored = parseRobots('User-agent: *\nDisallow: /menu$')
    expect(isAllowedByRobots(anchored, 'https://example.com/menu')).toBe(false)
    expect(isAllowedByRobots(anchored, 'https://example.com/menu/lunch')).toBe(true)
  })

  it('blocks everything when the site disallows the root', () => {
    const closed = parseRobots('User-agent: *\nDisallow: /')
    expect(isAllowedByRobots(closed, 'https://example.com/')).toBe(false)
    expect(isAllowedByRobots(closed, 'https://example.com/menu')).toBe(false)
  })

  it('allows everything when the file gave no rules', () => {
    expect(isAllowedByRobots({ disallowed: [] }, 'https://example.com/anything')).toBe(true)
  })

  it('refuses a URL it cannot parse instead of assuming it is fine', () => {
    expect(isAllowedByRobots({ disallowed: [] }, 'not a url')).toBe(false)
  })

  it('applies rules against the query string too', () => {
    const query = parseRobots('User-agent: *\nDisallow: /search?')
    expect(isAllowedByRobots(query, 'https://example.com/search?q=nasi')).toBe(false)
  })
})
