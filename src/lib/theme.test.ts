import { describe, expect, it } from 'vitest'

import {
  APPEARANCE_STORAGE_KEY,
  DEFAULT_APPEARANCE,
  applyResolvedTheme,
  normaliseAppearance,
  resolveTheme,
} from './theme'

describe('normaliseAppearance', () => {
  it('accepts the two explicit choices', () => {
    expect(normaliseAppearance('light')).toBe('light')
    expect(normaliseAppearance('dark')).toBe('dark')
  })

  it('defaults to System for everything else', () => {
    // 'system' itself, absence, junk from storage, junk from a profile doc.
    for (const value of ['system', null, undefined, '', 'DARK', 'auto', 42, {}]) {
      expect(normaliseAppearance(value)).toBe('system')
    }
    expect(DEFAULT_APPEARANCE).toBe('system')
  })
})

describe('resolveTheme', () => {
  it('an explicit choice wins regardless of the OS', () => {
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
  })

  it('System follows the OS preference in both directions', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
  })
})

describe('applyResolvedTheme', () => {
  function fakeRoot() {
    const classes = new Set<string>()
    return {
      root: {
        classList: {
          toggle: (name: string, force: boolean) => {
            if (force) classes.add(name)
            else classes.delete(name)
            return force
          },
        },
        style: { colorScheme: '' },
      } as unknown as HTMLElement,
      classes,
    }
  }

  it('stamps and removes the dark class, and keeps color-scheme in step', () => {
    const { root, classes } = fakeRoot()

    applyResolvedTheme('dark', root)
    expect(classes.has('dark')).toBe(true)
    expect(root.style.colorScheme).toBe('dark')

    applyResolvedTheme('light', root)
    expect(classes.has('dark')).toBe(false)
    expect(root.style.colorScheme).toBe('light')
  })
})

describe('pre-paint contract', () => {
  it('keeps the storage key the inline index.html script depends on', () => {
    expect(APPEARANCE_STORAGE_KEY).toBe('sevenbase.appearance')
  })
})
