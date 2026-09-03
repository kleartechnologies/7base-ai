import { describe, expect, it } from 'vitest'

import {
  firstUsableColor,
  normalizeHex,
  posterFileName,
  posterSpec,
  readableTextOn,
  wrapLines,
} from './posterSpec'

/**
 * The poster's layout decisions, tested where they are made. "Download
 * Poster" promises a real 1080px social image, and the preview and the
 * export share this spec — if these numbers drift, the owner downloads
 * something other than what they saw.
 */

describe('posterSpec', () => {
  it('exports real social sizes: 1080 square, 1080×1350 portrait', () => {
    expect(posterSpec('square_post', null)).toMatchObject({ width: 1080, height: 1080 })
    expect(posterSpec('portrait_post', null)).toMatchObject({ width: 1080, height: 1350 })
  })

  it('takes the accent from the brand palette, with readable text on it', () => {
    const spec = posterSpec('square_post', {
      palette: ['not-a-color', '#FFEE00'],
      headingFont: null,
      bodyFont: null,
      logoStoragePath: null,
    })
    expect(spec.accent).toBe('#ffee00')
    expect(spec.accentText).toBe('#1a1a1a')
  })

  it('falls back to the default accent without a usable palette', () => {
    expect(posterSpec('square_post', null).accent).toBe('#C2410C')
  })
})

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

describe('readableTextOn', () => {
  it('dark text on light accents, white on dark ones', () => {
    expect(readableTextOn('#ffffff')).toBe('#1a1a1a')
    expect(readableTextOn('#FFEE00')).toBe('#1a1a1a')
    expect(readableTextOn('#C2410C')).toBe('#ffffff')
    expect(readableTextOn('#000000')).toBe('#ffffff')
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
