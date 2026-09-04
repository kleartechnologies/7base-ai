import { onCall, type CallableRequest } from 'firebase-functions/v2/https'
import { logger } from 'firebase-functions'
import { AiServiceError } from '../ai/errors'
import {
  AiNotConfiguredError,
  AiResponseError,
  runStructuredTask,
} from '../ai/orchestrator'
import { OPENAI_API_KEY } from '../ai/openai.client'
import { assertOwnership, requireBusinessOwner, requireUid, resolvePlanForUser } from '../lib/auth'
import { internal, invalidArgument, permissionDenied } from '../lib/errors'
import { COLLECTIONS, db, FieldValue } from '../lib/firebase'
import type {
  BuildCampaignRequest,
  BuildCampaignResponse,
  MessageMeta,
  StoredMessage,
} from '../lib/types'
import type { StoredRecommendation } from '../marketing/store'
import { recommendedOpportunity } from '../marketing/validate'
import { draftCampaignFromRecommendation, mergePolish } from './draft'
import { buildCampaignBuiltPresentation } from './present'
import { buildPolishInput, CAMPAIGN_POLISH_PROMPT } from './prompt'
import { CAMPAIGN_POLISH_SCHEMA, CAMPAIGN_POLISH_SCHEMA_NAME } from './schema'
import { buildStoredCampaign, saveCampaign, type StoredCampaign } from './store'
import { CampaignValidationError, validateCampaignPolish, type CampaignContent } from './validate'

/**
 * [Build this campaign] — recommendation in, campaign out.
 *
 * The campaign's strategy fields are copied deterministically from the
 * recommendation (see draft.ts), so the campaign inherits exactly the
 * authority the recommendation earned. One fast-tier call polishes the copy
 * fields; if it fails for any reason, the deterministic draft ships anyway —
 * building a campaign never fails because a model was slow.
 *
 * The client sends only a recommendation id it already owns. Ownership is
 * re-checked here because the Admin SDK bypasses security rules, and the
 * confirmation message is written server-side like every assistant turn.
 */
export const campaignBuildFromRecommendation = onCall(
  {
    region: 'asia-southeast1',
    secrets: [OPENAI_API_KEY],
    // Fast-tier worst case (60s x 3 attempts) plus Firestore round trips.
    timeoutSeconds: 240,
    memory: '256MiB',
    maxInstances: 10,
    cors: true,
  },
  async (request: CallableRequest<BuildCampaignRequest>): Promise<BuildCampaignResponse> => {
    const uid = requireUid(request)
    const { recommendationId } = request.data ?? {}

    if (!recommendationId || typeof recommendationId !== 'string') {
      throw invalidArgument('A recommendationId is required.')
    }

    const recSnapshot = await db
      .collection(COLLECTIONS.recommendations)
      .doc(recommendationId)
      .get()
    // A missing document and someone else's document answer identically.
    if (!recSnapshot.exists) throw permissionDenied()
    const recommendation = recSnapshot.data() as StoredRecommendation
    assertOwnership(recommendation, uid)

    // Ownership of the business the recommendation points at, re-verified.
    const business = await requireBusinessOwner(recommendation.businessId, uid)

    // Server-resolved plan; the request payload has no say in model choice.
    const plan = await resolvePlanForUser(uid)

    try {
      let content: CampaignContent = draftCampaignFromRecommendation(recommendation)
      let meta: MessageMeta | null = null

      try {
        const opportunity = recommendedOpportunity(recommendation)
        const polishResult = await runStructuredTask<unknown>({
          task: 'campaign.build',
          plan,
          systemPrompt: CAMPAIGN_POLISH_PROMPT,
          input: buildPolishInput({
            businessName: typeof business?.name === 'string' ? business.name : null,
            goal: recommendation.goal,
            opportunityTitle: opportunity.title,
            opportunityDescription: opportunity.description,
            diagnosis: recommendation.diagnosis.statement,
            campaign: {
              targetAudience: content.targetAudience,
              offer: content.offer,
              positioning: content.positioning,
              keyMessage: content.keyMessage,
              callToAction: content.callToAction,
              channels: content.channels,
              durationDays: content.durationDays,
              unknowns: content.unknowns,
            },
          }),
          schema: {
            name: CAMPAIGN_POLISH_SCHEMA_NAME,
            schema: CAMPAIGN_POLISH_SCHEMA as unknown as Record<string, unknown>,
          },
        })
        content = mergePolish(content, validateCampaignPolish(polishResult.data))
        meta = polishResult.meta
      } catch (polishError) {
        // Polish is an improvement, not a dependency. The deterministic
        // draft is complete and honest without it.
        if (
          polishError instanceof AiNotConfiguredError ||
          polishError instanceof AiServiceError ||
          polishError instanceof AiResponseError ||
          polishError instanceof CampaignValidationError
        ) {
          logger.warn('Campaign polish skipped', {
            recommendationId,
            reason: polishError.message,
          })
        } else {
          throw polishError
        }
      }

      const stored: StoredCampaign = buildStoredCampaign({
        ownerId: uid,
        businessId: recommendation.businessId,
        conversationId: recommendation.conversationId ?? null,
        sourceRecommendationId: recommendationId,
        content,
        meta,
      })
      const campaignId = await saveCampaign(stored)

      // Announce it in the thread it came from, if that thread still exists.
      // The recommendation itself remains untouched — traceability runs
      // Campaign → sourceRecommendationId → diagnosis → Brain.
      let conversationId: string | null = null
      if (stored.conversationId) {
        const conversationRef = db
          .collection(COLLECTIONS.conversations)
          .doc(stored.conversationId)
        const conversationSnapshot = await conversationRef.get()
        if (conversationSnapshot.exists && conversationSnapshot.data()?.ownerId === uid) {
          const presentation = buildCampaignBuiltPresentation(campaignId, stored)
          const now = Date.now()
          const message: StoredMessage = {
            ownerId: uid,
            conversationId: stored.conversationId,
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
          conversationId = stored.conversationId
        }
      }

      logger.info('Campaign built from recommendation', {
        campaignId,
        recommendationId,
        conversationId,
        polished: meta !== null,
        model: meta?.model ?? null,
        latencyMs: meta?.latencyMs ?? null,
      })

      return { campaignId, conversationId }
    } catch (error) {
      throw internal('campaignBuildFromRecommendation', error)
    }
  },
)
