import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_LANGUAGE,
  LANGUAGE_LABELS,
  LANGUAGE_OPTIONS,
  LANGUAGE_STORAGE_KEY,
  normaliseLanguage,
} from './language'
import { en, type MessageKey } from './messages/en'
import { ms } from './messages/ms'
import { getLanguage, setLanguageValue, subscribeLanguage, t } from './store'
import { translate } from './translate'

const KEYS = Object.keys(en) as MessageKey[]

describe('dictionaries', () => {
  it('ms covers every en key with a non-empty string', () => {
    // The type system already forces coverage at compile time; this guards
    // the runtime shape too (an empty translation would satisfy the type).
    for (const key of KEYS) {
      expect(ms[key], key).toBeTypeOf('string')
      expect(ms[key].length, key).toBeGreaterThan(0)
    }
  })

  it('ms has no keys en does not have', () => {
    expect(Object.keys(ms).filter((key) => !(key in en))).toEqual([])
  })

  it('every {placeholder} in en appears in the ms translation, and vice versa', () => {
    const names = (message: string) =>
      [...message.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort()
    for (const key of KEYS) {
      expect(names(ms[key]), key).toEqual(names(en[key]))
    }
  })

  it('keeps product proper nouns untranslated', () => {
    for (const key of KEYS) {
      for (const noun of ['7BASE AI', 'EVA']) {
        if (en[key].includes(noun)) {
          expect(ms[key], `${key} should keep "${noun}"`).toContain(noun)
        }
      }
    }
  })
})

describe('translate', () => {
  it('resolves the same key per language', () => {
    expect(translate('en', 'common.cancel')).toBe('Cancel')
    expect(translate('ms', 'common.cancel')).toBe('Batal')
  })

  it('interpolates string and number params', () => {
    expect(translate('en', 'campaign.durationDays', { days: 7 })).toBe('7 days')
    expect(translate('en', 'business.questionProgress', { current: 2, total: 5 })).toBe('2 of 5')
  })

  it('leaves an unmatched placeholder visible instead of swallowing it', () => {
    expect(translate('en', 'campaign.durationDays')).toBe('{days} days')
    expect(translate('en', 'campaign.durationDays', { other: 1 })).toBe('{days} days')
  })

  it('ignores extra params that have no placeholder', () => {
    expect(translate('en', 'common.cancel', { days: 3 })).toBe('Cancel')
  })
})

describe('language preference logic', () => {
  it('normalises anything unsupported to English', () => {
    expect(normaliseLanguage('ms')).toBe('ms')
    expect(normaliseLanguage('en')).toBe('en')
    expect(normaliseLanguage('en-MY')).toBe('en')
    expect(normaliseLanguage('id')).toBe('en')
    expect(normaliseLanguage(null)).toBe('en')
    expect(normaliseLanguage(undefined)).toBe('en')
    expect(normaliseLanguage(42)).toBe('en')
  })

  it('defaults to English', () => {
    expect(DEFAULT_LANGUAGE).toBe('en')
  })

  it('offers exactly English and Bahasa Melayu, each named in itself', () => {
    expect(LANGUAGE_OPTIONS).toEqual(['en', 'ms'])
    expect(LANGUAGE_LABELS.en).toBe('English')
    expect(LANGUAGE_LABELS.ms).toBe('Bahasa Melayu')
  })

  it('pins the storage key (index.html pre-paint script reads it verbatim)', () => {
    expect(LANGUAGE_STORAGE_KEY).toBe('sevenbase.language')
  })
})

describe('language store', () => {
  afterEach(() => {
    // Other suites rely on the node-side default staying English.
    setLanguageValue('en')
  })

  it('starts at the default and drives t()', () => {
    expect(getLanguage()).toBe('en')
    expect(t('common.cancel')).toBe('Cancel')
    setLanguageValue('ms')
    expect(getLanguage()).toBe('ms')
    expect(t('common.cancel')).toBe('Batal')
  })

  it('notifies subscribers on change, but not on a no-op set', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeLanguage(listener)
    setLanguageValue('en') // already en — no notification
    expect(listener).not.toHaveBeenCalled()
    setLanguageValue('ms')
    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
    setLanguageValue('en')
    expect(listener).toHaveBeenCalledTimes(1)
  })
})
