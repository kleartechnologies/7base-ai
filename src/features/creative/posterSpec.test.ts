import { describe, expect, it } from 'vitest'

import { firstUsableColor, normalizeHex, posterFileName, wrapLines } from './posterSpec'

/**
 * The pure helpers under the poster pipeline. The layout decisions they used
 * to sit beside now live in `posterDesign.ts`; what is left is parsing and
 * wrapping, and both have caught real defects.
 */

describe('normalizeHex and firstUsableColor', () => {
  it('accepts 6- and 3-digit hex, rejects everything else', () => {
    expect(normalizeHex('#C2410C')).toBe('#c2410c')
    expect(normalizeHex(' #fa0 ')).toBe('#ffaa00')
    expect(normalizeHex('red')).toBeNull()
    expect(normalizeHex('#12345')).toBeNull()
  })

  it('picks the first parseable entry', () => {
    expect(firstUsableColor(['nope', '#abc', '#C2410C'])).toBe('#aabbcc')
    expect(firstUsableColor([])).toBeNull()
    expect(firstUsableColor(null)).toBeNull()
  })
})

describe('posterFileName', () => {
  it('slugs the name and states the format', () => {
    expect(posterFileName('Weekday Lunch Poster', 'square_post')).toBe(
      'weekday-lunch-poster-square.png',
    )
    expect(posterFileName('Kempen Raya!!', 'portrait_post')).toBe('kempen-raya-portrait.png')
  })

  it('never produces an empty slug', () => {
    expect(posterFileName('***', 'square_post')).toBe('poster-square.png')
  })
})

describe('wrapLines', () => {
  // A fake measurer: each character is one unit wide.
  const measure = (s: string) => s.length

  it('wraps greedily at the measured width', () => {
    expect(wrapLines('lunch without the wait', 12, measure)).toEqual([
      'lunch',
      'without the',
      'wait',
    ])
  })

  it('keeps a short line whole', () => {
    expect(wrapLines('lunch', 100, measure)).toEqual(['lunch'])
  })

  it('stops at maxLines instead of overflowing the poster', () => {
    const lines = wrapLines('one two three four five six seven', 3, measure, 3)
    expect(lines).toHaveLength(3)
  })
})
