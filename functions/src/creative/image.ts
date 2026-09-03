import { randomUUID } from 'node:crypto'
import { logger } from 'firebase-functions'
import { runImageTask } from '../ai/orchestrator'
import type { StoredCampaign } from '../campaign/store'
import type { Product, StoredBusiness } from '../lib/business.types'
import { storageBucket } from '../lib/firebase'
import type { MessageMeta } from '../lib/types'
import { buildImagePrompt } from './prompt'
import { CREATIVE_LIMITS, text, type CreativeFormat, type CreativeImageRef } from './validate'

/**
 * The creative's supporting image.
 *
 * Preference order is a product rule, not an optimisation: a real photo of
 * the business's own food beats a generated one every time. Only when the
 * Business Brain holds no usable image does MARKA generate one — and a
 * generated image is recorded as generated, never passed off as a photo.
 */

/** Real-photo fetch limits. A poster source, not an arbitrary proxy. */
const FETCH_TIMEOUT_MS = 15_000
const MAX_IMAGE_BYTES = 8 * 1024 * 1024
const IMAGE_CONTENT_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

export interface SelectedProductImage {
  product: Product
  url: string
}

/**
 * The business photo that best fits this campaign: a product whose name
 * appears in the campaign's offer or key message, else the signature
 * product, else the first product with a real image. Deterministic — no
 * model call to pick a photo.
 */
export function selectBusinessImage(
  business: StoredBusiness | null,
  campaign: StoredCampaign,
): SelectedProductImage | null {
  if (!business) return null
  const withImages = business.products.filter(
    (product): product is Product & { imageUrl: string } =>
      typeof product.imageUrl === 'string' && /^https:\/\//i.test(product.imageUrl),
  )
  if (withImages.length === 0) return null

  const campaignText = [
    campaign.offer?.description,
    campaign.keyMessage,
    campaign.name,
    campaign.objective,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()

  const first = withImages[0]
  if (!first) return null
  const mentioned = withImages.find((product) =>
    campaignText.includes(product.name.toLowerCase()),
  )
  const chosen = mentioned ?? withImages.find((product) => product.isSignature) ?? first
  return { product: chosen, url: chosen.imageUrl }
}

/**
 * Copies a real business photo into the creative's own Storage folder, so
 * the poster keeps working if the source site changes. Size, type and time
 * limits — this fetches a known product image, it is not a general proxy.
 */
export async function fetchAssetToStorage(params: {
  url: string
  businessId: string
  altText: string | null
}): Promise<CreativeImageRef> {
  const response = await fetch(params.url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    redirect: 'follow',
  })
  if (!response.ok) throw new Error(`asset fetch returned ${response.status}`)

  const contentType = (response.headers.get('content-type') ?? '').split(';')[0]?.trim() ?? ''
  const extension = IMAGE_CONTENT_TYPES[contentType]
  if (!extension) throw new Error(`asset is not an image (${contentType || 'no content type'})`)

  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new Error(`asset size out of bounds (${bytes.byteLength} bytes)`)
  }

  const storagePath = `businesses/${params.businessId}/creatives/${randomUUID()}.${extension}`
  await saveToStorage(storagePath, bytes, contentType)

  return {
    storagePath,
    prompt: null,
    altText: params.altText,
    // A photo from the business's own records is their asset, not stock.
    source: 'upload',
  }
}

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
}): Promise<GeneratedImage> {
  const brand = params.business?.brand?.value ?? null
  const prompt = buildImagePrompt({
    brief: params.brief,
    format: params.format,
    paletteHexes: (brand?.colors ?? []).map((color) => color.hex).slice(0, 3),
    visualStyle: text(brand?.visualStyle ?? null, CREATIVE_LIMITS.imageBrief),
  })

  const result = await runImageTask({
    task: 'creative.generate_image',
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
