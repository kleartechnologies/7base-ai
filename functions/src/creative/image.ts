import { randomUUID } from 'node:crypto'
import { logger } from 'firebase-functions'
import { runImageTask } from '../ai/orchestrator'
import type { SubscriptionPlan } from '../config/models'
import type { StoredBusiness } from '../lib/business.types'
import { storageBucket } from '../lib/firebase'
import type { MessageMeta } from '../lib/types'
import type { PosterComposition } from './artDirection'
import { resolveBrandStyle, resolveVisualStyle } from './brand'
import type { CreativeDirection } from './direction'
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
  /**
   * The creative direction this poster is being designed in, chosen
   * deterministically in `direction.ts`. It art-directs the brief and is
   * persisted on the creative, so a retry regenerates in the same direction
   * the client is laying the poster out in.
   */
  direction: CreativeDirection
  /**
   * Where the subject must sit and where the frame must stay quiet. The
   * renderer lays this poster out from the same composition, so the
   * photograph is made for the layout rather than cropped into it.
   */
  composition: PosterComposition
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
    direction: params.direction,
    composition: params.composition,
    paletteHexes: (brandStyle.palette ?? []).slice(0, 3),
    visualStyle: resolveVisualStyle(params.business, CREATIVE_LIMITS.imageBrief),
    businessType: businessTypeLine(params.business),
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
 * What the business calls itself, in a few words, so the brief is about a
 * bakery or a tuition centre rather than a generic "small business". Clamped
 * and stripped of line breaks — recorded business text, but text all the
 * same, and it is going into a prompt.
 */
function businessTypeLine(business: StoredBusiness | null): string | null {
  const raw = business?.identity.businessType ?? business?.identity.category ?? null
  if (!raw) return null
  const clean = raw.replace(/\s+/g, ' ').trim().slice(0, 60)
  return clean.length > 0 ? clean : null
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
