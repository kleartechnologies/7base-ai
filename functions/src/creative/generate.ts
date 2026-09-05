import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https'
import { logger } from 'firebase-functions'
import { AiServiceError } from '../ai/errors'
import {
  AiNotConfiguredError,
  AiResponseError,
  runStructuredTask,
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
import {
  AssetUnavailableError,
  buildAssetImageRef,
  buildCreativeAssetProvenance,
  copyAssetToCreativeStorage,
  listEligibleAssets,
  resolveRetryImage,
  selectCreativeAsset,
  selectLogoAsset,
} from './assets'
import { buildGroundingCorpus, draftCreativeCopyFromCampaign, mergeCopy } from './draft'
import { generateCreativeImage } from './image'
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
        key: `creative.generate_${uid}_${campaignId}`,
        ownerId: uid,
        operation: 'creative.generate',
        busyMessage: 'Materials for this campaign are already being created. Give it a moment.',
      },
      generateOnce,
    )

    async function generateOnce(): Promise<GenerateCreativeResponse> {
    try {
      const corpus = buildGroundingCorpus({ campaign, business })

      // The owner's Assets, resolved server-side and scoped to their own
      // business: the poster photo and the logo are both chosen
      // deterministically here — the image model never picks between a real
      // photo and a generated one.
      const assets = await listEligibleAssets(campaign.businessId, uid)
      const productAsset = selectCreativeAsset(assets, campaign, business?.products ?? [])
      const logoAsset = selectLogoAsset(assets)

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
        const copyResult = await runStructuredTask<unknown>({
          task: 'creative.generate_copy',
          uid,
          plan,
          systemPrompt: CREATIVE_COPY_PROMPT,
          input: buildCopyInput({
            businessName: business?.name ?? null,
            brandVoice: business?.brand?.value.voice ?? null,
            campaign,
            format,
            directives: [],
            hasRealImage: productAsset !== null,
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
          const snapshotPath = await copyAssetToCreativeStorage(
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
          const generated = await generateCreativeImage({
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
            storagePath: await copyAssetToCreativeStorage(logoAsset.asset, campaign.businessId),
          }
        } catch (logoError) {
          logger.warn('Logo snapshot failed; poster ships without a logo', {
            campaignId,
            assetId: logoAsset.id,
            reason: logoError instanceof Error ? logoError.message : 'unknown',
          })
        }
      }

      // 4. Persist. The brand's stored style rides along for the renderer.
      const brand = business?.brand?.value ?? null
      const style: CreativeStyle = {
        palette: brand && brand.colors.length > 0 ? brand.colors.map((c) => c.hex) : null,
        headingFont: brand?.fontFamily ?? null,
        bodyFont: null,
        logoStoragePath: logo?.storagePath ?? null,
        logoAssetId: logo?.assetId ?? null,
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
      const creativeId = await saveCreative(stored)

      // 5. Announce it in the thread it came from, if that thread exists.
      const conversationId = await announceInConversation(
        uid,
        stored.conversationId,
        buildCreativePresentation(creativeId, stored, { fallbackCopy: copyFellBack }),
        meta,
      )

      logger.info('Creative generated from campaign', {
        creativeId,
        campaignId,
        conversationId,
        imageSource: image?.source ?? null,
        // Asset-vs-generated origin: an assetId means the image model was
        // never called for the poster visual.
        productAssetId: image?.assetId ?? null,
        logoAssetId: logo?.assetId ?? null,
        imageReady: image !== null,
        copied: !copyFellBack,
      })

      return { creativeId, conversationId, imageReady: image !== null }
    } catch (error) {
      // Guardrail and validation HttpsErrors already carry the message the
      // owner should read; wrapping them in `internal` would swallow it.
      if (error instanceof HttpsError) throw error
      throw internal('creativeGenerateFromCampaign', error)
    }
    }
  },
)

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
