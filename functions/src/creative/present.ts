import type { CreativePreviewBlock, MessageBlock } from '../lib/types'
import type { StoredCreative } from './store'
import type { CreativeEditableField } from './validate'

/**
 * How a creative appears in the thread: a short sentence in MARKA's voice
 * plus a structured preview block that *references* the persisted creative
 * and duplicates only what it renders — same pattern as recommendation and
 * campaign blocks. The honesty rules live here too: a generated visual is
 * introduced as generated, and an image failure is stated plainly with the
 * copy still delivered.
 */

/** §26 verbatim: the copy survives an image failure, and says so. */
export const IMAGE_FAILED_LEAD =
  'I couldn’t create the image right now, but your marketing copy is ready. You can retry the image from the preview below.'

/**
 * Honesty rule for the deterministic fallback: when the AI wording call was
 * unavailable, the copy that ships is assembled verbatim from the campaign.
 * It is still delivered — generation is never blocked — but it is announced
 * as a draft so the owner reviews it rather than publishing it as-is.
 */
export const FALLBACK_COPY_NOTE =
  'My AI writer wasn’t available just now, so this is draft copy taken directly from your campaign. Review and reword it before publishing — or ask me again later and I’ll polish it.'

export interface CreativePresentation {
  blocks: MessageBlock[]
  plainText: string
}

export function buildCreativePreviewBlock(
  id: string,
  creativeId: string,
  creative: StoredCreative,
): CreativePreviewBlock {
  const image = creative.content.image
  return {
    id,
    type: 'creative_preview',
    creativeId,
    campaignId: creative.campaignId,
    name: creative.name,
    format: creative.format,
    headline: creative.content.headline,
    subheadline: creative.content.subheadline,
    callToAction: creative.content.callToAction,
    offerText: creative.content.offerText,
    image:
      image && image.storagePath
        ? { storagePath: image.storagePath, source: image.source, altText: image.altText }
        : null,
    imageFailed: creative.imageError !== null,
    captions: { ...creative.captions },
  }
}

export function buildCreativePresentation(
  creativeId: string,
  creative: StoredCreative,
  options?: { fallbackCopy?: boolean },
): CreativePresentation {
  const source = creative.content.image?.source
  const baseLead =
    creative.imageError !== null
      ? IMAGE_FAILED_LEAD
      : source === 'generated'
        ? 'Here are your marketing materials. I didn’t find a photo of yours that fits, so the visual is AI-generated — tell me what to change, or swap in your own photo later.'
        : source === 'upload'
          ? 'Here are your marketing materials — I used one of your own photos for the poster. Tell me what to change, and everything is yours to download.'
          : 'Here are your marketing materials. Tell me what to change, and everything is yours to download.'
  const lead = options?.fallbackCopy ? `${baseLead} ${FALLBACK_COPY_NOTE}` : baseLead
  return {
    blocks: [
      { id: 'b0', type: 'text', text: lead },
      buildCreativePreviewBlock('b1', creativeId, creative),
    ],
    plainText: `${lead}\n\nCreative: ${creative.name}`,
  }
}

export function buildCreativeEditPresentation(
  creativeId: string,
  creative: StoredCreative,
  reply: string | null,
  changed: CreativeEditableField[],
): CreativePresentation {
  const lead =
    reply ??
    (changed.length > 0
      ? 'Done — I’ve updated your materials.'
      : 'I looked at your materials and didn’t change anything for that.')
  return {
    blocks: [
      { id: 'b0', type: 'text', text: lead },
      buildCreativePreviewBlock('b1', creativeId, creative),
    ],
    plainText: `${lead}\n\nCreative: ${creative.name}`,
  }
}

export function buildCreativeRetryPresentation(
  creativeId: string,
  creative: StoredCreative,
): CreativePresentation {
  const lead =
    creative.imageError !== null
      ? 'I still couldn’t create the image — your copy is untouched and you can try again in a moment.'
      : 'Done — your poster image is ready.'
  return {
    blocks: [
      { id: 'b0', type: 'text', text: lead },
      buildCreativePreviewBlock('b1', creativeId, creative),
    ],
    plainText: `${lead}\n\nCreative: ${creative.name}`,
  }
}
