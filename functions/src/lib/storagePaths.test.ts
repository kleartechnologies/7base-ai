import { describe, expect, it } from 'vitest'

import { isPathWithinBusiness } from './storagePaths'

describe('isPathWithinBusiness', () => {
  it('accepts a path inside the claimed business', () => {
    expect(isPathWithinBusiness('businesses/biz1/assets/1000_a.jpg', 'biz1')).toBe(true)
    expect(
      isPathWithinBusiness('businesses/biz1/conversations/c1/attachments/a1_x.pdf', 'biz1'),
    ).toBe(true)
  })

  it("rejects a path inside another business", () => {
    expect(isPathWithinBusiness('businesses/victim/assets/secret.jpg', 'attacker')).toBe(false)
  })

  it('is a literal comparison: a regex-metacharacter business id matches nothing else', () => {
    // `.*` is a legal Firestore document id. As a regex it would match any
    // business segment; as a literal prefix it matches only itself.
    expect(isPathWithinBusiness('businesses/victim/assets/secret.jpg', '.*')).toBe(false)
    expect(isPathWithinBusiness('businesses/.*/assets/own.jpg', '.*')).toBe(true)
  })

  it('rejects a business id that is a prefix of the path segment', () => {
    // 'biz' must not claim 'businesses/biz2/...' — the trailing slash pins
    // the full segment.
    expect(isPathWithinBusiness('businesses/biz2/assets/a.jpg', 'biz')).toBe(false)
  })

  it('rejects paths outside the businesses namespace', () => {
    expect(isPathWithinBusiness('other/place.jpg', 'biz1')).toBe(false)
    expect(isPathWithinBusiness('businesses/', 'biz1')).toBe(false)
  })

  it('rejects malformed inputs', () => {
    expect(isPathWithinBusiness(null, 'biz1')).toBe(false)
    expect(isPathWithinBusiness('businesses/biz1/assets/a.jpg', '')).toBe(false)
    expect(isPathWithinBusiness('businesses/biz1/assets/a.jpg', null)).toBe(false)
    expect(isPathWithinBusiness('businesses/a/b/x.jpg', 'a/b')).toBe(false)
  })
})
