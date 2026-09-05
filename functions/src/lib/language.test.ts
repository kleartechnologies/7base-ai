import { describe, expect, it } from 'vitest'

import { DEFAULT_USER_LANGUAGE, normaliseUserLanguage } from './language'

/**
 * Every malformed or unexpected shape must land on English — the preference
 * only ever biases EVA's default reply language, but a surprising value must
 * still never leak anything other than a supported language into the prompt.
 */
describe('normaliseUserLanguage', () => {
  it('selects Bahasa Melayu only on the exact stored value', () => {
    expect(normaliseUserLanguage({ preferences: { language: 'ms' } })).toBe('ms')
  })

  it('resolves anything else to English', () => {
    expect(normaliseUserLanguage({ preferences: { language: 'en' } })).toBe('en')
    expect(normaliseUserLanguage({ preferences: { language: 'ms-MY' } })).toBe('en')
    expect(normaliseUserLanguage({ preferences: { language: 'id' } })).toBe('en')
    expect(normaliseUserLanguage({ preferences: { language: 'MS' } })).toBe('en')
    expect(normaliseUserLanguage({ preferences: { language: 42 } })).toBe('en')
    expect(normaliseUserLanguage({ preferences: { language: null } })).toBe('en')
  })

  it('resolves missing or malformed shapes to English', () => {
    expect(normaliseUserLanguage(null)).toBe('en')
    expect(normaliseUserLanguage(undefined)).toBe('en')
    expect(normaliseUserLanguage('ms')).toBe('en')
    expect(normaliseUserLanguage({})).toBe('en')
    expect(normaliseUserLanguage({ preferences: null })).toBe('en')
    expect(normaliseUserLanguage({ preferences: 'ms' })).toBe('en')
    expect(normaliseUserLanguage({ language: 'ms' })).toBe('en')
  })

  it('defaults to English', () => {
    expect(DEFAULT_USER_LANGUAGE).toBe('en')
  })
})
