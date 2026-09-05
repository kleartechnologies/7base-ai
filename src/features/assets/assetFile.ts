import { t } from '@/i18n/store'
import { ASSET_TYPES, type AssetType } from '@/types/asset'

/**
 * Upload validation and metadata normalisation, kept pure — no Firebase, no
 * DOM — so every rule here is testable in milliseconds.
 *
 * The MIME allow-list is deliberately narrower than the Storage rule
 * (`image/*` or PDF, under 20 MiB): SVG is an `image/*` type the rule would
 * admit, but it is a script container, so the client refuses it by name.
 */

export const ACCEPTED_ASSET_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
] as const

/** Mirrors the Storage rule's `size < 20 MiB` — exactly 20 MiB is too big. */
export const MAX_ASSET_BYTES = 20 * 1024 * 1024

/** For the file input's `accept` attribute. Advisory only; validate too. */
export const ASSET_FILE_ACCEPT = '.jpg,.jpeg,.png,.webp,.pdf'

export interface AssetFileCheck {
  ok: boolean
  /** Owner-readable reason when not ok. */
  reason: string | null
}

/** Shape-only view of `File` so tests need no DOM. */
export interface FileLike {
  name: string
  type: string
  size: number
}

export function validateAssetFile(file: FileLike): AssetFileCheck {
  // Reasons resolve through the i18n store at call time, so they follow the
  // owner's current UI language.
  if (file.type === 'image/svg+xml') {
    return { ok: false, reason: t('asset.invalidSvg') }
  }
  if (!(ACCEPTED_ASSET_MIME_TYPES as readonly string[]).includes(file.type)) {
    return { ok: false, reason: t('asset.invalidType') }
  }
  if (file.size >= MAX_ASSET_BYTES) {
    return { ok: false, reason: t('asset.tooLarge') }
  }
  if (file.size <= 0) {
    return { ok: false, reason: t('asset.emptyFile') }
  }
  return { ok: true, reason: null }
}

export function isAssetType(value: string): value is AssetType {
  return (ASSET_TYPES as readonly string[]).includes(value)
}

/** A starting display name: the file name without its extension. */
export function defaultAssetName(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, '').trim()
  return base || t('asset.untitled')
}

/** A starting type from the MIME type; the owner refines it afterwards. */
export function defaultAssetType(contentType: string): AssetType {
  return contentType === 'application/pdf' ? 'document' : 'photo'
}

/**
 * "mandhi, chicken, lunch" → ['mandhi', 'chicken', 'lunch'].
 *
 * Splits on commas, trims, drops empties, and de-duplicates
 * case-insensitively while keeping the casing the owner first typed.
 */
export function normalizeTags(input: string): string[] {
  const seen = new Set<string>()
  const tags: string[] = []
  for (const raw of input.split(',')) {
    const tag = raw.trim()
    if (!tag) continue
    const key = tag.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    tags.push(tag)
  }
  return tags
}

/** The stored array back to the editable text form. */
export function tagsToInput(tags: string[]): string {
  return tags.join(', ')
}

export function formatFileSize(sizeBytes: number): string {
  if (sizeBytes >= 1024 * 1024) return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`
  if (sizeBytes >= 1024) return `${Math.round(sizeBytes / 1024)} KB`
  return `${sizeBytes} B`
}
