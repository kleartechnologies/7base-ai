import { randomUUID } from 'node:crypto'
import { logger } from 'firebase-functions'
import { runImageTask } from '../ai/orchestrator'
import type { SubscriptionPlan } from '../config/models'
import type { StoredBusiness } from '../lib/business.types'
import { storageBucket } from '../lib/firebase'
import type { MessageMeta } from '../lib/types'
import { resolveBrandStyle, resolveVisualStyle } from './brand'
import { buildImagePrompt } from './prompt'
import { CREATIVE_LIMITS, type CreativeFormat, type CreativeImageRef } from './validate'

/**
 * The creative's generated image.
 *
 * Generation is the fallback, not the default: a real photo from the owner's
 * Assets library beats a generated one every time (see `assets.ts` for that
 * deterministic selection). Only when no usable asset exists does MARKA
 * generate — and a generated image is recorded as generated, never passed
 * off as a photo, and never claims an assetId.
 */

export interface GeneratedImage {
  image: CreativeImageRef
  meta: MessageMeta
}

/**
 * Generates the poster visual on the image tier and persists it. The prompt
 * is assembled from the validated brief and the brand's recorded style —
 * raw user text never reaches the image model. The image itself carries no
 * words: text is overlaid from the structured fields at render time, so a
 * wording edit never costs a regeneration.
 */
export async function generateCreativeImage(params: {
  businessId: string
  brief: string
  altText: string | null
  format: CreativeFormat
  business: StoredBusiness | null
  /** The authenticated owner — the account whose image quota this consumes. */
  uid: string
  /**
   * Server-resolved subscription plan, from the callable boundary. Both
   * plans use the same image model; this feeds the per-plan cost telemetry.
   */
  plan: SubscriptionPlan
}): Promise<GeneratedImage> {
  // Brand Identity first, discovered brand as fallback — resolved from the
  // business document, so retries and visual edits inherit it the same way.
  const brandStyle = resolveBrandStyle(params.business)
  const prompt = buildImagePrompt({
    brief: params.brief,
    format: params.format,
    paletteHexes: (brandStyle.palette ?? []).slice(0, 3),
    visualStyle: resolveVisualStyle(params.business, CREATIVE_LIMITS.imageBrief),
  })

  const result = await runImageTask({
    task: 'creative.generate_image',
    uid: params.uid,
    plan: params.plan,
    prompt,
    size: params.format === 'portrait_post' ? '1024x1536' : '1024x1024',
  })

  const storagePath = `businesses/${params.businessId}/creatives/${randomUUID()}.png`
  await saveToStorage(storagePath, result.imageBytes, 'image/png')

  return {
    image: { storagePath, prompt, altText: params.altText, source: 'generated' },
    meta: result.meta,
  }
}

/**
 * Writes bytes to the default bucket with a download token, so the client's
 * `getDownloadURL` works on Admin-SDK uploads the same as on its own.
 */
async function saveToStorage(
  storagePath: string,
  bytes: Buffer,
  contentType: string,
): Promise<void> {
  await storageBucket()
    .file(storagePath)
    .save(bytes, {
      contentType,
      metadata: { metadata: { firebaseStorageDownloadTokens: randomUUID() } },
    })
  logger.info('creative.asset.stored', { storagePath, bytes: bytes.byteLength, contentType })
}
