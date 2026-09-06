import { randomUUID } from 'node:crypto'
import { logger } from 'firebase-functions'
import type { StoredCampaign } from '../campaign/store'
import type { SubscriptionPlan } from '../config/models'
import type { Product, StoredBusiness } from '../lib/business.types'
import { COLLECTIONS, db, storageBucket } from '../lib/firebase'
import { isPathWithinBusiness } from '../lib/storagePaths'
import type { MessageMeta } from '../lib/types'
import { generateCreativeImage } from './image'
import type { StoredCreative } from './store'
import type { CreativeImageRef } from './validate'

/**
 * How a creative's imagery comes from the owner's Assets library.
 *
 * Every decision here is deterministic — which asset fits the campaign, which
 * logo to use, whether a retry may regenerate. The image model never chooses
 * between a real photo and a generated one, and an uploaded business file is
 * never sent to it: a selected asset is copied server-side into the
 * creative's own Storage folder and composited client-side.
 *
 * Every lookup is scoped to the authenticated owner and their business.
 * Client-supplied ids are never trusted past that check: a missing asset and
 * another business's asset answer identically.
 */

/** The stored asset shape. Mirrors `src/types/asset.ts` — change together. */
export interface StoredAsset {
  ownerId: string
  businessId: string
  type:
    | 'product'
    | 'menu'
    | 'logo'
    | 'brand'
    | 'photo'
    | 'document'
    | 'promotional'
    | 'other'
  name: string
  fileName: string
  contentType: string
  sizeBytes: number
  storagePath: string
  productId: string | null
  description: string | null
  tags: string[]
  source: 'upload'
  status: 'active' | 'archived'
  allowAiUse: boolean
  createdAt: number
  updatedAt: number
}

export interface AssetWithId {
  id: string
  asset: StoredAsset
}

/** Poster-usable image types. A menu PDF is an asset but never a poster. */
const ASSET_IMAGE_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

/**
 * The image is gone from the owner's library, so the retry (or edit) cannot
 * honour the promise that their own photo stays on the poster. Carried as an
 * owner-facing sentence — never silently substituted with AI imagery.
 */
export class AssetUnavailableError extends Error {
  /** Safe to show the owner as-is. */
  readonly ownerMessage: string
  constructor(ownerMessage: string) {
    super(ownerMessage)
    this.name = 'AssetUnavailableError'
    this.ownerMessage = ownerMessage
  }
}

const ASSET_UNAVAILABLE_MESSAGE =
  'This poster uses one of your own photos, but that photo is no longer available for marketing use. Check it in Assets — it may be archived or have “Allow EVA to use” turned off — or create a new poster from the campaign.'

const ASSET_UNLINKED_MESSAGE =
  'This poster’s photo isn’t connected to your Assets library, so it can’t be refreshed. Upload the photo to Assets and create a new poster from the campaign.'

export const UPLOAD_IMAGE_KEPT_NOTE =
  'This poster uses your own photo, so I’ve kept it rather than replacing it with an AI-generated image.'

/**
 * Every asset the creative pipeline may consider for this business: owned by
 * the caller, active, cleared for AI/marketing use, and an actual image.
 * Equality-only query (no composite index), filtered and stably ordered in
 * memory — a business holds tens of assets, not thousands.
 */
export async function listEligibleAssets(
  businessId: string,
  ownerId: string,
): Promise<AssetWithId[]> {
  const snapshot = await db
    .collection(COLLECTIONS.assets)
    .where('businessId', '==', businessId)
    .where('ownerId', '==', ownerId)
    .get()

  return snapshot.docs
    .map((doc) => ({ id: doc.id, asset: doc.data() as StoredAsset }))
    .filter(
      ({ asset }) =>
        asset.status === 'active' &&
        asset.allowAiUse === true &&
        ASSET_IMAGE_EXTENSIONS[asset.contentType] !== undefined &&
        // Never even select a document whose file lies outside its own
        // business — defence in depth behind the same check in the copy.
        isPathWithinBusiness(asset.storagePath, asset.businessId),
    )
    .sort((a, b) => a.asset.createdAt - b.asset.createdAt || a.id.localeCompare(b.id))
}

/**
 * The uploaded photo that best fits this campaign, or null when generation
 * should run instead. Deterministic, like `selectBusinessImage` before it:
 * only product and photo assets qualify (never menus, logos or documents),
 * and the preference order is — an asset explicitly linked to a product the
 * campaign mentions, then one whose own name/description/tags mention such a
 * product, then the signature product's asset, then the first product photo.
 */
export function selectCreativeAsset(
  assets: AssetWithId[],
  campaign: StoredCampaign,
  products: Product[],
): AssetWithId | null {
  const candidates = assets.filter(
    ({ asset }) => asset.type === 'product' || asset.type === 'photo',
  )
  if (candidates.length === 0) return null

  const campaignText = [
    campaign.offer?.description,
    campaign.keyMessage,
    campaign.name,
    campaign.objective,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()

  const mentioned = products.filter(
    (product) => product.name && campaignText.includes(product.name.toLowerCase()),
  )

  // A. Explicitly linked to a product the campaign talks about.
  for (const product of mentioned) {
    const linked = candidates.find(({ asset }) => asset.productId === product.id)
    if (linked) return linked
  }

  // B. The asset's own metadata names a product the campaign talks about.
  for (const product of mentioned) {
    const needle = product.name.toLowerCase()
    const match = candidates.find(({ asset }) => assetMentions(asset, needle))
    if (match) return match
  }

  // C. Generic fallback, mirroring the old product-image order: the
  // signature product's asset, else the first product shot, else any photo.
  const signature = products.find((product) => product.isSignature)
  if (signature) {
    const linked = candidates.find(({ asset }) => asset.productId === signature.id)
    if (linked) return linked
  }
  return candidates.find(({ asset }) => asset.type === 'product') ?? candidates[0] ?? null
}

function assetMentions(asset: StoredAsset, needle: string): boolean {
  return (
    asset.name.toLowerCase().includes(needle) ||
    (asset.description ?? '').toLowerCase().includes(needle) ||
    asset.tags.some((tag) => tag.toLowerCase().includes(needle))
  )
}

/**
 * The business's logo, when one exists in Assets. The owner's official logo
 * (Brand Identity's `logoAssetId`) wins when it is still in the eligible
 * list; otherwise the first eligible logo-type asset in stable order. It is
 * composited onto the poster client-side — never selected by, sent to, or
 * recreated by the image model. `preferredAssetId` is read from the business
 * document server-side, never from the request.
 */
export function selectLogoAsset(
  assets: AssetWithId[],
  preferredAssetId: string | null = null,
): AssetWithId | null {
  if (preferredAssetId) {
    const official = assets.find(({ id }) => id === preferredAssetId)
    if (official) return official
  }
  return assets.find(({ asset }) => asset.type === 'logo') ?? null
}

/**
 * Copies the asset's file server-side into the creative's own Storage folder
 * (`businesses/{businessId}/creatives/`), so the poster keeps working if the
 * asset is later archived or deleted. A GCS-to-GCS copy through the Admin
 * SDK — no HTTP fetch, no client-supplied URL.
 */
export async function copyAssetToCreativeStorage(
  asset: StoredAsset,
  businessId: string,
): Promise<string> {
  const extension = ASSET_IMAGE_EXTENSIONS[asset.contentType]
  if (!extension) {
    throw new Error(`asset is not a poster-usable image (${asset.contentType})`)
  }
  // The source path is client-recorded at asset creation and this copy
  // bypasses Storage rules, so containment is re-checked here: the file must
  // live inside the asset's own business. Literal prefix, never a regex.
  if (!isPathWithinBusiness(asset.storagePath, asset.businessId)) {
    throw new Error('asset storagePath is outside its own business')
  }
  const storagePath = `businesses/${businessId}/creatives/${randomUUID()}.${extension}`
  const bucket = storageBucket()
  const destination = bucket.file(storagePath)
  await bucket.file(asset.storagePath).copy(destination)
  // A fresh download token, same as every server-written creative image, so
  // the client's getDownloadURL works without inheriting the source's token.
  await destination.setMetadata({
    metadata: { firebaseStorageDownloadTokens: randomUUID() },
  })
  logger.info('creative.asset.copied', { from: asset.storagePath, to: storagePath })
  return storagePath
}

/** The frozen provenance an asset-backed poster image carries. */
export function buildAssetImageRef(params: {
  assetId: string
  asset: StoredAsset
  storagePath: string
  altText: string | null
}): CreativeImageRef {
  return {
    storagePath: params.storagePath,
    prompt: null,
    altText:
      params.altText ?? params.asset.description ?? `Photo of ${params.asset.name}`,
    source: 'upload',
    assetId: params.assetId,
  }
}

/** Only assets actually on the creative — never speculative, never padded. */
export function buildCreativeAssetProvenance(params: {
  productAssetId: string | null
  logoAssetId: string | null
}): string[] {
  return [params.productAssetId, params.logoAssetId].filter(
    (id): id is string => id !== null,
  )
}

/**
 * Re-resolves an asset-backed image from its source Asset: same ownership
 * checks as the original selection, then a fresh creative-owned snapshot.
 * Throws `AssetUnavailableError` (owner-readable) when the asset is missing,
 * belongs elsewhere, is archived, or lost AI permission — the caller must
 * surface that, never quietly switch to generation.
 */
export async function refreshUploadImage(params: {
  assetId: string | null
  businessId: string
  ownerId: string
  altText: string | null
}): Promise<CreativeImageRef> {
  if (!params.assetId) throw new AssetUnavailableError(ASSET_UNLINKED_MESSAGE)

  const snapshot = await db.collection(COLLECTIONS.assets).doc(params.assetId).get()
  const asset = snapshot.exists ? (snapshot.data() as StoredAsset) : null
  const reason = asset ? assetIneligibility(asset, params) : 'missing'
  if (!asset || reason) {
    logger.warn('creative.asset.refresh_refused', { assetId: params.assetId, reason })
    throw new AssetUnavailableError(ASSET_UNAVAILABLE_MESSAGE)
  }

  let storagePath: string
  try {
    storagePath = await copyAssetToCreativeStorage(asset, params.businessId)
  } catch (copyError) {
    logger.warn('creative.asset.refresh_copy_failed', {
      assetId: params.assetId,
      reason: copyError instanceof Error ? copyError.message : 'unknown',
    })
    throw new AssetUnavailableError(ASSET_UNAVAILABLE_MESSAGE)
  }
  return buildAssetImageRef({
    assetId: params.assetId,
    asset,
    storagePath,
    altText: params.altText,
  })
}

/**
 * Why this asset may not back a creative for this caller, or null when it
 * may. A cross-business or cross-owner asset is refused here regardless of
 * what the client claimed — ids are resolved, never trusted.
 */
export function assetIneligibility(
  asset: StoredAsset,
  scope: { businessId: string; ownerId: string },
): string | null {
  if (asset.ownerId !== scope.ownerId) return 'not_owner'
  if (asset.businessId !== scope.businessId) return 'wrong_business'
  if (asset.status !== 'active') return 'not_active'
  if (asset.allowAiUse !== true) return 'ai_use_disallowed'
  if (ASSET_IMAGE_EXTENSIONS[asset.contentType] === undefined) return 'not_an_image'
  if (!isPathWithinBusiness(asset.storagePath, asset.businessId)) return 'path_outside_business'
  return null
}

/* --- retry and visual-edit decisions ------------------------------------ */

/**
 * The effectful collaborators, injectable so the decision logic is testable
 * without Firebase or OpenAI. Production callers use the defaults.
 */
export interface ImageSourceDeps {
  refreshUpload: typeof refreshUploadImage
  generate: typeof generateCreativeImage
}

const defaultDeps: ImageSourceDeps = {
  refreshUpload: refreshUploadImage,
  generate: generateCreativeImage,
}

/**
 * What [Try again] means for this creative's image. An asset-backed poster
 * re-resolves and re-snapshots its source Asset — the image model is never
 * called for it, and an unavailable asset fails loudly rather than being
 * replaced by AI imagery. A generated poster regenerates as before.
 */
export async function resolveRetryImage(
  params: {
    creative: StoredCreative
    ownerId: string
    business: StoredBusiness | null
    plan: SubscriptionPlan
  },
  deps: ImageSourceDeps = defaultDeps,
): Promise<{ image: CreativeImageRef; meta: MessageMeta | null }> {
  const { creative } = params
  const image = creative.content.image

  if (image?.source === 'upload') {
    const refreshed = await deps.refreshUpload({
      assetId: image.assetId ?? null,
      businessId: creative.businessId,
      ownerId: params.ownerId,
      altText: image.altText,
    })
    return { image: refreshed, meta: null }
  }

  const fallbackBrief = [creative.content.headline, creative.content.subheadline]
    .filter(Boolean)
    .join('. ')
  const generated = await deps.generate({
    businessId: creative.businessId,
    brief: image?.prompt ?? (fallbackBrief || creative.name),
    altText: image?.altText ?? null,
    format: creative.format,
    business: params.business,
    uid: params.ownerId,
    plan: params.plan,
  })
  return { image: generated.image, meta: generated.meta }
}

export type VisualEditImage =
  | {
      action: 'replaced'
      image: CreativeImageRef
      meta: MessageMeta | null
      /** Owner-facing note when their photo was kept. Null for generated. */
      note: string | null
    }
  | { action: 'kept'; note: string }

/**
 * What a visual-change instruction means for this creative's image. A poster
 * on the owner's own photo keeps that photo: the Asset is re-resolved and
 * re-snapshotted (same assetId), never swapped for AI imagery — transforming
 * a real photo with AI would be a separate, explicit capability. A generated
 * poster regenerates from the validated brief, as before.
 */
export async function resolveVisualEditImage(
  params: {
    creative: StoredCreative
    visualChange: string
    ownerId: string
    business: StoredBusiness | null
    plan: SubscriptionPlan
  },
  deps: ImageSourceDeps = defaultDeps,
): Promise<VisualEditImage> {
  const { creative } = params
  const image = creative.content.image

  if (image?.source === 'upload') {
    try {
      const refreshed = await deps.refreshUpload({
        assetId: image.assetId ?? null,
        businessId: creative.businessId,
        ownerId: params.ownerId,
        altText: image.altText,
      })
      return { action: 'replaced', image: refreshed, meta: null, note: UPLOAD_IMAGE_KEPT_NOTE }
    } catch (error) {
      // The existing creative-owned snapshot still stands; keep it.
      if (error instanceof AssetUnavailableError) {
        return { action: 'kept', note: UPLOAD_IMAGE_KEPT_NOTE }
      }
      throw error
    }
  }

  const generated = await deps.generate({
    businessId: creative.businessId,
    brief: params.visualChange,
    altText: image?.altText ?? null,
    format: creative.format,
    business: params.business,
    uid: params.ownerId,
    plan: params.plan,
  })
  return { action: 'replaced', image: generated.image, meta: generated.meta, note: null }
}
