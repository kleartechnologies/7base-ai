import { describe, expect, it } from 'vitest'
import { buildAssetPath } from '@/services/storage/storage.service'
import {
  ACCEPTED_ASSET_MIME_TYPES,
  MAX_ASSET_BYTES,
  defaultAssetName,
  defaultAssetType,
  formatFileSize,
  isAssetType,
  normalizeTags,
  tagsToInput,
  validateAssetFile,
} from './assetFile'

const file = (over: Partial<{ name: string; type: string; size: number }> = {}) => ({
  name: 'mandhi.jpg',
  type: 'image/jpeg',
  size: 1024,
  ...over,
})

describe('validateAssetFile', () => {
  it('accepts every allowed image type and PDF', () => {
    for (const type of ACCEPTED_ASSET_MIME_TYPES) {
      expect(validateAssetFile(file({ type }))).toEqual({ ok: true, reason: null })
    }
  })

  it('rejects SVG by name even though Storage rules would admit image/*', () => {
    const check = validateAssetFile(file({ name: 'logo.svg', type: 'image/svg+xml' }))
    expect(check.ok).toBe(false)
    expect(check.reason).toMatch(/SVG/)
  })

  it('rejects other unsupported types', () => {
    for (const type of ['image/gif', 'video/mp4', 'text/html', 'application/zip', '']) {
      expect(validateAssetFile(file({ type })).ok).toBe(false)
    }
  })

  it('accepts a file one byte under the 20 MiB limit', () => {
    expect(validateAssetFile(file({ size: MAX_ASSET_BYTES - 1 })).ok).toBe(true)
  })

  it('rejects exactly 20 MiB — the Storage rule is a strict less-than', () => {
    const check = validateAssetFile(file({ size: MAX_ASSET_BYTES }))
    expect(check.ok).toBe(false)
    expect(check.reason).toMatch(/too large/)
  })

  it('rejects oversized and empty files', () => {
    expect(validateAssetFile(file({ size: MAX_ASSET_BYTES + 1 })).ok).toBe(false)
    expect(validateAssetFile(file({ size: 0 })).ok).toBe(false)
  })
})

describe('asset storage paths', () => {
  it('generates paths inside the business assets folder', () => {
    const path = buildAssetPath('biz1', 'assets', 'mandhi.jpg')
    expect(path).toMatch(/^businesses\/biz1\/assets\/\d+_mandhi\.jpg$/)
  })

  it('sanitizes hostile file names into the safe character set', () => {
    const path = buildAssetPath('biz1', 'assets', '../../../etc/passwd')
    expect(path).toMatch(/^businesses\/biz1\/assets\/\d+_\.\._\.\._\.\._etc_passwd$/)
    const spaced = buildAssetPath('biz1', 'assets', 'my menu (final) #2.pdf')
    expect(spaced).toMatch(/^businesses\/biz1\/assets\/\d+_my_menu_final_2\.pdf$/)
  })
})

describe('metadata defaults', () => {
  it('derives a display name from the file name', () => {
    expect(defaultAssetName('mandhi.jpg')).toBe('mandhi')
    expect(defaultAssetName('menu.final.pdf')).toBe('menu.final')
    expect(defaultAssetName('.pdf')).toBe('Untitled asset')
    expect(defaultAssetName('')).toBe('Untitled asset')
  })

  it('defaults images to photo and PDFs to document', () => {
    expect(defaultAssetType('image/jpeg')).toBe('photo')
    expect(defaultAssetType('image/webp')).toBe('photo')
    expect(defaultAssetType('application/pdf')).toBe('document')
  })
})

describe('isAssetType', () => {
  it('accepts every declared type and nothing else', () => {
    for (const type of ['product', 'menu', 'logo', 'brand', 'photo', 'document', 'promotional', 'other']) {
      expect(isAssetType(type)).toBe(true)
    }
    expect(isAssetType('video')).toBe(false)
    expect(isAssetType('')).toBe(false)
    expect(isAssetType('Photo')).toBe(false)
  })
})

describe('normalizeTags', () => {
  it('splits on commas, trims, and drops empties', () => {
    expect(normalizeTags('mandhi, chicken, lunch')).toEqual(['mandhi', 'chicken', 'lunch'])
    expect(normalizeTags('  spicy ,, halal ,')).toEqual(['spicy', 'halal'])
    expect(normalizeTags('')).toEqual([])
    expect(normalizeTags('   ,  , ')).toEqual([])
  })

  it('de-duplicates case-insensitively, keeping the first casing', () => {
    expect(normalizeTags('Halal, halal, HALAL, spicy')).toEqual(['Halal', 'spicy'])
  })

  it('round-trips through the editable text form', () => {
    expect(tagsToInput(normalizeTags('mandhi, chicken'))).toBe('mandhi, chicken')
    expect(tagsToInput([])).toBe('')
  })
})

describe('formatFileSize', () => {
  it('formats bytes, kilobytes and megabytes', () => {
    expect(formatFileSize(512)).toBe('512 B')
    expect(formatFileSize(2048)).toBe('2 KB')
    expect(formatFileSize(3 * 1024 * 1024)).toBe('3.0 MB')
  })
})
