import type { Creative, CreativeCaptions, CreativeEditableField } from '@/types'
import type { MessageKey } from '@/i18n/messages/en'

/**
 * The platform copy that belongs to one creative.
 *
 * There is no second store of marketing text: this reads the creative's own
 * `captions`, the same field the generation call writes and conversational
 * editing patches. Each platform is one caption field, named here once so the
 * card, the chat preview and the tests all agree on which field is which.
 *
 * A platform whose caption is empty is simply absent from the list. Creatives
 * written before Phase 7H have no `x` or `tiktok` at all, and the honest
 * answer for them is "this wasn't written", never a rewrapped general caption
 * presented as a TikTok post.
 */

export type CopyPlatform = 'general' | 'facebook' | 'instagram' | 'x' | 'tiktok' | 'whatsapp'

interface PlatformSpec {
  platform: CopyPlatform
  /** The caption field this platform is stored in. */
  field: keyof CreativeCaptions
  /** The editable-field name the owner's authority is recorded under. */
  editable: CreativeEditableField
  label: MessageKey
  /** Short label for the chip row, where space is tight. */
  chip: MessageKey
}

/**
 * Order matters: general first because it is the one an owner reaches for
 * without thinking, then the platforms in the order Malaysian small
 * businesses actually use them.
 */
export const COPY_PLATFORMS: readonly PlatformSpec[] = [
  {
    platform: 'general',
    field: 'short',
    editable: 'shortCopy',
    label: 'creative.platformGeneral',
    chip: 'creative.platformGeneralChip',
  },
  {
    platform: 'facebook',
    field: 'facebook',
    editable: 'facebookCaption',
    label: 'creative.platformFacebook',
    chip: 'creative.platformFacebookChip',
  },
  {
    platform: 'instagram',
    field: 'instagram',
    editable: 'instagramCaption',
    label: 'creative.platformInstagram',
    chip: 'creative.platformInstagramChip',
  },
  {
    platform: 'x',
    field: 'x',
    editable: 'xCopy',
    label: 'creative.platformX',
    chip: 'creative.platformXChip',
  },
  {
    platform: 'tiktok',
    field: 'tiktok',
    editable: 'tiktokCopy',
    label: 'creative.platformTiktok',
    chip: 'creative.platformTiktokChip',
  },
  {
    platform: 'whatsapp',
    field: 'whatsapp',
    editable: 'whatsappCopy',
    label: 'creative.platformWhatsapp',
    chip: 'creative.platformWhatsappChip',
  },
] as const

export interface PlatformCopyEntry extends PlatformSpec {
  text: string
}

/** Every platform this creative actually has copy for, in display order. */
export function platformCopyEntries(captions: CreativeCaptions | null): PlatformCopyEntry[] {
  if (!captions) return []
  const entries: PlatformCopyEntry[] = []
  for (const spec of COPY_PLATFORMS) {
    const value = captions[spec.field]
    const text = typeof value === 'string' ? value.trim() : ''
    if (text.length > 0) entries.push({ ...spec, text })
  }
  return entries
}

/**
 * The one-line preview shown while the copy section is collapsed. The general
 * caption when there is one, otherwise whatever the first platform is — never
 * a stitched-together summary of all of them.
 */
export function collapsedPreview(entries: PlatformCopyEntry[]): string | null {
  const first = entries[0]
  if (!first) return null
  return first.text.replace(/\s+/g, ' ').trim()
}

/** Whether the owner has taken authority over this platform's copy already. */
export function isOwnerEdited(creative: Creative, entry: PlatformCopyEntry): boolean {
  return creative.userEdited.includes(entry.editable)
}
