import { onCall, type CallableRequest } from 'firebase-functions/v2/https'
import { logger } from 'firebase-functions'
import { AiServiceError } from '../ai/errors'
import {
  AiNotConfiguredError,
  AiResponseError,
  runStructuredTask,
} from '../ai/orchestrator'
import { OPENAI_API_KEY } from '../ai/openai.client'
import type { StoredCampaign } from '../campaign/store'
import { assertOwnership, requireBusinessOwner, requireUid } from '../lib/auth'
import type { StoredBusiness } from '../lib/business.types'
import { internal, invalidArgument, permissionDenied } from '../lib/errors'
import { COLLECTIONS, db, FieldValue } from '../lib/firebase'
import type {
  GenerateCreativeRequest,
  GenerateCreativeResponse,
  MessageMeta,
  RetryCreativeImageRequest,
  RetryCreativeImageResponse,
  StoredMessage,
} from '../lib/types'
import { buildGroundingCorpus, draftCreativeCopyFromCampaign, mergeCopy } from './draft'
import { fetchAssetToStorage, generateCreativeImage, selectBusinessImage } from './image'
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

    try {
      const corpus = buildGroundingCorpus({ campaign, business })
      const realImage = selectBusinessImage(business, campaign)

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
          systemPrompt: CREATIVE_COPY_PROMPT,
          input: buildCopyInput({
            businessName: business?.name ?? null,
            brandVoice: business?.brand?.value.voice ?? null,
            campaign,
            format,
            directives: [],
            hasRealImage: realImage !== null,
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
        if (
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

      // 2. Visual: real business photo first, generated only when none fits.
      let image: CreativeImageRef | null = null
      let imageError: string | null = null

      if (realImage) {
        try {
          image = await fetchAssetToStorage({
            url: realImage.url,
            businessId: campaign.businessId,
            altText: altText ?? `Photo of ${realImage.product.name}`,
          })
        } catch (fetchError) {
          logger.warn('Real asset fetch failed; falling back to generation', {
            campaignId,
            reason: fetchError instanceof Error ? fetchError.message : 'unknown',
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
          })
          image = generated.image
          meta = meta ?? generated.meta
        } catch (imageErrorRaw) {
          if (
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

      // 3. Persist. The brand's stored style rides along for the renderer.
      const brand = business?.brand?.value ?? null
      const style: CreativeStyle = {
        palette: brand && brand.colors.length > 0 ? brand.colors.map((c) => c.hex) : null,
        headingFont: brand?.fontFamily ?? null,
        bodyFont: null,
        logoStoragePath: null,
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
        imageError,
        meta,
      })
      // Fallback copy is stored as a draft (an existing status, no new
      // shape): the campaign's own words shipped unworded, so the record
      // itself says "review me" rather than presenting as finished copy.
      const stored: StoredCreative = copyFellBack ? { ...built, status: 'draft' } : built
      const creativeId = await saveCreative(stored)

      // 4. Announce it in the thread it came from, if that thread exists.
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
        imageReady: image !== null,
        copied: !copyFellBack,
      })

      return { creativeId, conversationId, imageReady: image !== null }
    } catch (error) {
      throw internal('creativeGenerateFromCampaign', error)
    }
  },
)

/**
 * [Try again] on a failed poster image. Regenerates the visual only — the
 * copy, the authority record and the creative's identity are untouched.
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

    try {
      const fallbackBrief = [creative.content.headline, creative.content.subheadline]
        .filter(Boolean)
        .join('. ')
      const brief = creative.content.image?.prompt ?? (fallbackBrief || creative.name)

      let next: StoredCreative
      try {
        const generated = await generateCreativeImage({
          businessId: creative.businessId,
          brief,
          altText: creative.content.image?.altText ?? null,
          format: creative.format,
          business,
        })
        next = {
          ...creative,
          content: { ...creative.content, image: generated.image, layout: 'image_full_bleed' },
          imageError: null,
          updatedAt: Date.now(),
        }
      } catch (imageErrorRaw) {
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
      throw internal('creativeRetryImage', error)
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
