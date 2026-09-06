import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https'
import { logger } from 'firebase-functions'
import { AiServiceError } from '../ai/errors'
import {
  AiNotConfiguredError,
  AiResponseError,
  runStructuredTask,
  type StructuredRequest,
  type StructuredResult,
} from '../ai/orchestrator'
import { OPENAI_API_KEY } from '../ai/openai.client'
import type { StoredCampaign } from '../campaign/store'
import { assertOwnership, requireBusinessOwner, requireUid, resolvePlanForUser } from '../lib/auth'
import type { StoredBusiness } from '../lib/business.types'
import { internal, invalidArgument, permissionDenied } from '../lib/errors'
import { COLLECTIONS, db, FieldValue } from '../lib/firebase'
import { withOperationLock } from '../lib/operationLock'
import type {
  GenerateCreativeRequest,
  GenerateCreativeResponse,
  MessageMeta,
  RetryCreativeImageRequest,
  RetryCreativeImageResponse,
  StoredMessage,
} from '../lib/types'
import type { SubscriptionPlan } from '../config/models'
import {
  AssetUnavailableError,
  buildAssetImageRef,
  buildCreativeAssetProvenance,
  copyAssetToCreativeStorage,
  listEligibleAssets,
  resolveRetryImage,
  selectCreativeAsset,
  selectLogoAsset,
  type AssetWithId,
} from './assets'
import { brandAppliedSummary, brandStyleLine, readBrandKit, resolveBrandStyle } from './brand'
import { buildGroundingCorpus, draftCreativeCopyFromCampaign, mergeCopy } from './draft'
import { generateCreativeImage, type GeneratedImage } from './image'
import {
  buildCreativePresentation,
  buildCreativeRetryPresentation,
  type CreativePresentation,
} from './present'
import { buildCopyInput, CREATIVE_COPY_PROMPT } from './prompt'
import { CREATIVE_COPY_SCHEMA, CREATIVE_COPY_SCHEMA_NAME } from './schema'
import {
  buildStoredCreative,
  saveCreative,
  updateStoredCreative,
  type StoredCreative,
} from './store'
import {
  CreativeValidationError,
  readFormat,
  validateCreativeCopy,
  type CreativeFormat,
  type CreativeImageRef,
  type CreativeStyle,
} from './validate'

/**
 * [Create marketing materials] — campaign in, creative out.
 *
 * The creative inherits the campaign's strategy verbatim; nothing here
 * re-decides audience, offer or message, and no reasoning-tier call is made.
 * One fast-tier call words the copy (with a deterministic, campaign-only
 * fallback if it fails), and the visual prefers a real business photo over a
 * generated one. An image failure never blocks the materials: the copy
 * ships, the failure is stated plainly, and the owner can retry.
 */

/** Owner-facing image failure line. Provider internals never surface. */
const IMAGE_ERROR_MESSAGE = 'The poster image could not be created.'

export const creativeGenerateFromCampaign = onCall(
  {
    region: 'asia-southeast1',
    secrets: [OPENAI_API_KEY],
    // Fast-tier copy worst case (60s x 3 attempts) + image tier worst case
    // (120s x 2 attempts) + asset fetch + Firestore/Storage round trips.
    timeoutSeconds: 540,
    memory: '512MiB',
    maxInstances: 10,
    cors: true,
  },
  async (
    request: CallableRequest<GenerateCreativeRequest>,
  ): Promise<GenerateCreativeResponse> => {
    const uid = requireUid(request)
    const { campaignId } = request.data ?? {}
    const format = readFormat(request.data?.format)

    if (!campaignId || typeof campaignId !== 'string') {
      throw invalidArgument('A campaignId is required.')
    }

    const campaignSnapshot = await db.collection(COLLECTIONS.campaigns).doc(campaignId).get()
    // A missing document and someone else's document answer identically.
    if (!campaignSnapshot.exists) throw permissionDenied()
    const campaign = campaignSnapshot.data() as StoredCampaign
    assertOwnership(campaign, uid)

    // Ownership of the business the campaign points at, re-verified.
    const business = (await requireBusinessOwner(campaign.businessId, uid)) as
      | StoredBusiness
      | null

    // Server-resolved plan; the request payload has no say in model choice.
    const plan = await resolvePlanForUser(uid)

    // One generation per campaign *at a time*: a double-click or client retry
    // is refused before any model spend, while a deliberate later "create
    // materials again" for the same campaign stays legitimate — the lock is
    // in-flight only, released when this run settles. Acquired only after
    // the ownership checks above.
    return withOperationLock(
      {
        key: creativeGenerateLockKey(uid, campaignId),
        ownerId: uid,
        operation: 'creative.generate',
        busyMessage: CREATIVE_GENERATE_BUSY_MESSAGE,
      },
      generateOnce,
    )

    async function generateOnce(): Promise<GenerateCreativeResponse> {
      try {
        const result = await generateCreativeForCampaign({
          uid,
          plan,
          campaignId,
          campaign,
          business,
          format,
          setContext: null,
          avoidAssetIds: [],
        })

        // Announce it in the thread it came from, if that thread exists.
        const conversationId = await announceInConversation(
          uid,
          result.creative.conversationId,
          buildCreativePresentation(result.creativeId, result.creative, {
            fallbackCopy: result.copyFellBack,
          }),
          result.meta,
        )

        return {
          creativeId: result.creativeId,
          conversationId,
          imageReady: result.creative.content.image !== null,
        }
      } catch (error) {
        // Guardrail and validation HttpsErrors already carry the message the
        // owner should read; wrapping them in `internal` would swallow it.
        if (error instanceof HttpsError) throw error
        throw internal('creativeGenerateFromCampaign', error)
      }
    }
  },
)

/** The in-flight lock every creative generation for a campaign runs under. */
export function creativeGenerateLockKey(uid: string, campaignId: string): string {
  return `creative.generate_${uid}_${campaignId}`
}

export const CREATIVE_GENERATE_BUSY_MESSAGE =
  'Materials for this campaign are already being created. Give it a moment.'

export interface CreativeGenerationParams {
  uid: string
  plan: SubscriptionPlan
  campaignId: string
  /** Already ownership-checked by the caller. */
  campaign: StoredCampaign
  /** Already ownership-checked by the caller; null when the business is gone. */
  business: StoredBusiness | null
  format: CreativeFormat
  /**
   * Phase 7F: this poster's place in a multi-poster chat request, worded for
   * the copy call. Null for a single poster.
   */
  setContext: string | null
  /** Phase 7F: photos already used by earlier posters of the same set. */
  avoidAssetIds: readonly string[]
}

export interface CreativeGenerationResult {
  creativeId: string
  creative: StoredCreative
  /** True when the AI wording call failed and the deterministic draft shipped. */
  copyFellBack: boolean
  meta: MessageMeta | null
}

/**
 * The seams a test replaces. Production uses the real Assets, Storage,
 * orchestrator, image and Firestore functions — there is exactly one
 * generation path, whichever door the owner came through.
 */
export interface CreativeGenerationDeps {
  listEligibleAssets: (businessId: string, ownerId: string) => Promise<AssetWithId[]>
  copyAssetToCreativeStorage: typeof copyAssetToCreativeStorage
  runCopy: (request: StructuredRequest) => Promise<StructuredResult<unknown>>
  generateImage: (
    params: Parameters<typeof generateCreativeImage>[0],
  ) => Promise<GeneratedImage>
  saveCreative: (creative: StoredCreative) => Promise<string>
}

const defaultCreativeGenerationDeps: CreativeGenerationDeps = {
  listEligibleAssets,
  copyAssetToCreativeStorage,
  runCopy: (request) => runStructuredTask<unknown>(request),
  generateImage: generateCreativeImage,
  saveCreative,
}

/**
 * The one creative-generation pipeline: campaign in, persisted creative out.
 * Shared verbatim by the [Create marketing materials] button
 * (`creativeGenerateFromCampaign`) and EVA's chat action (Phase 7F) — the
 * chat path gains no second implementation, only a caller. Ownership, plan
 * resolution and the per-campaign lock are the caller's job; the usage
 * guardrail runs inside the orchestrator calls as always.
 *
 * Nothing here announces in chat: each caller presents the result its own way.
 */
export async function generateCreativeForCampaign(
  params: CreativeGenerationParams,
  deps: CreativeGenerationDeps = defaultCreativeGenerationDeps,
): Promise<CreativeGenerationResult> {
  const { uid, plan, campaignId, campaign, business, format } = params
  const corpus = buildGroundingCorpus({ campaign, business })

  // The owner's Assets, resolved server-side and scoped to their own
  // business: the poster photo and the logo are both chosen
  // deterministically here — the image model never picks between a real
  // photo and a generated one.
  const assets = await deps.listEligibleAssets(campaign.businessId, uid)
  const productAsset = selectCreativeAsset(assets, campaign, business?.products ?? [], {
    avoidAssetIds: params.avoidAssetIds,
  })
  // The official Brand Identity logo (read from the business document,
  // never the request) outranks the type-based heuristic.
  const brandKit = readBrandKit(business)
  const logoAsset = selectLogoAsset(assets, brandKit?.logoAssetId ?? null)

  // 1. Copy: deterministic draft first, fast-tier wording on top.
  let draft = draftCreativeCopyFromCampaign(campaign)
  let imageBrief: string | null = null
  let altText: string | null = null
  let meta: MessageMeta | null = null
  // True when the AI wording call failed and the deterministic draft
  // ships as-is. It is still delivered — never blocked — but announced
  // as draft copy and stored with status 'draft' so the owner reviews it.
  let copyFellBack = false

  try {
    const copyResult = await deps.runCopy({
      task: 'creative.generate_copy',
      uid,
      plan,
      systemPrompt: CREATIVE_COPY_PROMPT,
      input: buildCopyInput({
        businessName: business?.name ?? null,
        brandVoice: business?.brand?.value.voice ?? null,
        brandStyle: brandStyleLine(business),
        campaign,
        format,
        directives: [],
        hasRealImage: productAsset !== null,
        setContext: params.setContext,
      }),
      schema: {
        name: CREATIVE_COPY_SCHEMA_NAME,
        schema: CREATIVE_COPY_SCHEMA as unknown as Record<string, unknown>,
      },
    })
    const copy = validateCreativeCopy(copyResult.data, corpus)
    draft = mergeCopy(draft, copy)
    imageBrief = copy.imageBrief
    altText = copy.altText
    meta = copyResult.meta
  } catch (copyError) {
    // Wording is an improvement, not a dependency. The deterministic
    // draft says only what the campaign already says, and ships.
    // HttpsError means the usage guardrail blocked the call before any
    // OpenAI spend — the unworded draft is the graceful degradation.
    if (
      copyError instanceof HttpsError ||
      copyError instanceof AiNotConfiguredError ||
      copyError instanceof AiServiceError ||
      copyError instanceof AiResponseError ||
      copyError instanceof CreativeValidationError
    ) {
      copyFellBack = true
      logger.warn('Creative copy call skipped', { campaignId, reason: copyError.message })
    } else {
      throw copyError
    }
  }

  // 2. Visual: the owner's own photo first, generated only when none
  // fits. A selected asset is snapshotted into the creative's own
  // Storage folder — GCS copy, no HTTP fetch — and the image model is
  // never called for it.
  let image: CreativeImageRef | null = null
  let imageError: string | null = null

  if (productAsset) {
    try {
      const snapshotPath = await deps.copyAssetToCreativeStorage(
        productAsset.asset,
        campaign.businessId,
      )
      image = buildAssetImageRef({
        assetId: productAsset.id,
        asset: productAsset.asset,
        storagePath: snapshotPath,
        altText,
      })
    } catch (copyError) {
      logger.warn('Asset snapshot failed; falling back to generation', {
        campaignId,
        assetId: productAsset.id,
        reason: copyError instanceof Error ? copyError.message : 'unknown',
      })
    }
  }

  if (!image) {
    const campaignBrief = [campaign.offer?.description, campaign.keyMessage, campaign.positioning]
      .filter(Boolean)
      .join('. ')
    const brief = imageBrief ?? (campaignBrief || campaign.name)
    try {
      const generated = await deps.generateImage({
        businessId: campaign.businessId,
        brief,
        altText,
        format,
        business,
        uid,
        plan,
      })
      image = generated.image
      meta = meta ?? generated.meta
    } catch (imageErrorRaw) {
      // A guardrail block (HttpsError) carries the sentence the owner
      // should read — "today's image-generation limit" beats a generic
      // failure line, and the copy work already done still ships.
      if (imageErrorRaw instanceof HttpsError) {
        logger.warn('Creative image generation blocked', { campaignId })
        imageError = imageErrorRaw.message
      } else if (
        imageErrorRaw instanceof AiNotConfiguredError ||
        imageErrorRaw instanceof AiServiceError ||
        imageErrorRaw instanceof AiResponseError
      ) {
        logger.warn('Creative image generation failed', {
          campaignId,
          reason: imageErrorRaw.message,
        })
        imageError = IMAGE_ERROR_MESSAGE
      } else {
        throw imageErrorRaw
      }
    }
  }

  // 3. Logo: same deterministic path — snapshotted for the client-side
  // compositor, never sent to (or recreated by) the image model. A logo
  // failure only costs the logo, never the poster.
  let logo: { assetId: string; storagePath: string } | null = null
  if (logoAsset) {
    try {
      logo = {
        assetId: logoAsset.id,
        storagePath: await deps.copyAssetToCreativeStorage(logoAsset.asset, campaign.businessId),
      }
    } catch (logoError) {
      logger.warn('Logo snapshot failed; poster ships without a logo', {
        campaignId,
        assetId: logoAsset.id,
        reason: logoError instanceof Error ? logoError.message : 'unknown',
      })
    }
  }

  // 4. Persist. Brand Identity first, the discovered brand as fallback —
  // resolved from the business document, so the client cannot inject
  // brand values through the request. `brandApplied` records honestly
  // which parts the owner's kit actually contributed.
  const brandStyle = resolveBrandStyle(business)
  const style: CreativeStyle = {
    palette: brandStyle.palette,
    headingFont: brandStyle.headingFont,
    bodyFont: brandStyle.bodyFont,
    logoStoragePath: logo?.storagePath ?? null,
    logoAssetId: logo?.assetId ?? null,
    brandApplied: brandAppliedSummary(business, {
      logoFromKit: logo !== null && logo.assetId === brandKit?.logoAssetId,
      kitColors: brandStyle.kitColors,
      kitTypography: brandStyle.kitTypography,
    }),
  }
  const built = buildStoredCreative({
    ownerId: uid,
    businessId: campaign.businessId,
    campaignId,
    conversationId: campaign.conversationId,
    sourceRecommendationId: campaign.sourceRecommendationId,
    name: draft.name,
    format,
    content: { ...draft.content, image, layout: image ? 'image_full_bleed' : 'text_only' },
    captions: draft.captions,
    style,
    assetIds: buildCreativeAssetProvenance({
      productAssetId: image?.assetId ?? null,
      logoAssetId: logo?.assetId ?? null,
    }),
    imageError,
    meta,
  })
  // Fallback copy is stored as a draft (an existing status, no new
  // shape): the campaign's own words shipped unworded, so the record
  // itself says "review me" rather than presenting as finished copy.
  const stored: StoredCreative = copyFellBack ? { ...built, status: 'draft' } : built
  const creativeId = await deps.saveCreative(stored)

  logger.info('Creative generated from campaign', {
    creativeId,
    campaignId,
    conversationId: stored.conversationId,
    imageSource: image?.source ?? null,
    // Asset-vs-generated origin: an assetId means the image model was
    // never called for the poster visual.
    productAssetId: image?.assetId ?? null,
    logoAssetId: logo?.assetId ?? null,
    imageReady: image !== null,
    copied: !copyFellBack,
    inSet: params.setContext !== null,
  })

  return { creativeId, creative: stored, copyFellBack, meta }
}

/**
 * [Try again] on a failed poster image. Refreshes the visual only — the
 * copy, the authority record and the creative's identity are untouched.
 * An asset-backed poster re-snapshots its source Asset (never the image
 * model); a generated poster regenerates.
 */
export const creativeRetryImage = onCall(
  {
    region: 'asia-southeast1',
    secrets: [OPENAI_API_KEY],
    // Image tier worst case (120s x 2 attempts) plus round trips.
    timeoutSeconds: 300,
    memory: '512MiB',
    maxInstances: 10,
    cors: true,
  },
  async (
    request: CallableRequest<RetryCreativeImageRequest>,
  ): Promise<RetryCreativeImageResponse> => {
    const uid = requireUid(request)
    const { creativeId } = request.data ?? {}

    if (!creativeId || typeof creativeId !== 'string') {
      throw invalidArgument('A creativeId is required.')
    }

    const creativeRef = db.collection(COLLECTIONS.creatives).doc(creativeId)
    const creativeSnapshot = await creativeRef.get()
    if (!creativeSnapshot.exists) throw permissionDenied()
    const creative = creativeSnapshot.data() as StoredCreative
    assertOwnership(creative, uid)

    const business = (await requireBusinessOwner(creative.businessId, uid)) as
      | StoredBusiness
      | null

    // Server-resolved plan; the request payload has no say in model choice.
    const plan = await resolvePlanForUser(uid)

    // One retry per creative at a time — a double-clicked [Try again] must
    // not buy two image calls. In-flight only; a later deliberate retry is
    // fine. Acquired only after the ownership checks above.
    return withOperationLock(
      {
        key: `creative.retry_${uid}_${creativeId}`,
        ownerId: uid,
        operation: 'creative.retry',
        busyMessage: 'This poster is already being retried. Give it a moment.',
      },
      retryOnce,
    )

    async function retryOnce(): Promise<RetryCreativeImageResponse> {
    try {
      let next: StoredCreative
      try {
        const resolved = await resolveRetryImage({ creative, ownerId: uid, business, plan })
        next = {
          ...creative,
          // Same assets as before: an upload retry keeps its assetId, a
          // generated retry never gains one. Legacy docs are healed to [].
          assetIds: creative.assetIds ?? [],
          content: { ...creative.content, image: resolved.image, layout: 'image_full_bleed' },
          imageError: null,
          updatedAt: Date.now(),
        }
      } catch (imageErrorRaw) {
        // The source Asset is gone or no longer usable. Fail with the
        // actionable sentence — never silently substitute AI imagery.
        if (imageErrorRaw instanceof AssetUnavailableError) {
          throw new HttpsError('failed-precondition', imageErrorRaw.ownerMessage)
        }
        if (
          imageErrorRaw instanceof AiNotConfiguredError ||
          imageErrorRaw instanceof AiServiceError ||
          imageErrorRaw instanceof AiResponseError
        ) {
          logger.warn('Creative image retry failed', {
            creativeId,
            reason: imageErrorRaw.message,
          })
          next = { ...creative, imageError: IMAGE_ERROR_MESSAGE, updatedAt: Date.now() }
        } else {
          throw imageErrorRaw
        }
      }

      await updateStoredCreative(creativeId, next)

      const conversationId = await announceInConversation(
        uid,
        next.conversationId,
        buildCreativeRetryPresentation(creativeId, next),
        null,
      )

      return { creativeId, conversationId, imageReady: next.imageError === null }
    } catch (error) {
      // The actionable asset-unavailable message must reach the owner as-is.
      if (error instanceof HttpsError) throw error
      throw internal('creativeRetryImage', error)
    }
    }
  },
)

/**
 * Writes the assistant announcement into the conversation, when it still
 * exists and still belongs to the caller. Same shape as the campaign
 * announcement — assistant messages are only ever written server-side.
 */
async function announceInConversation(
  uid: string,
  conversationId: string | null,
  presentation: CreativePresentation,
  meta: MessageMeta | null,
): Promise<string | null> {
  if (!conversationId) return null
  const conversationRef = db.collection(COLLECTIONS.conversations).doc(conversationId)
  const conversationSnapshot = await conversationRef.get()
  if (!conversationSnapshot.exists || conversationSnapshot.data()?.ownerId !== uid) {
    return null
  }
  const now = Date.now()
  const message: StoredMessage = {
    ownerId: uid,
    conversationId,
    role: 'assistant',
    blocks: presentation.blocks,
    plainText: presentation.plainText,
    status: 'complete',
    meta,
    createdAt: now,
    updatedAt: now,
  }
  await conversationRef.collection(COLLECTIONS.messages).add(message)
  await conversationRef.update({
    lastMessagePreview: presentation.plainText.slice(0, 140),
    messageCount: FieldValue.increment(1),
    updatedAt: now,
  })
  return conversationId
}
