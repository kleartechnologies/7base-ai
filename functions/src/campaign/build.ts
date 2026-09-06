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
import type { SubscriptionPlan } from '../config/models'
import { assertOwnership, requireBusinessOwner, requireUid, resolvePlanForUser } from '../lib/auth'
import { internal, invalidArgument, permissionDenied } from '../lib/errors'
import { COLLECTIONS, db, FieldValue } from '../lib/firebase'
import { withOperationLock } from '../lib/operationLock'
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
import {
  buildStoredCampaign,
  findCampaignByRecommendation,
  saveCampaign,
  type StoredCampaign,
} from './store'
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

    // One build per recommendation, ever: a concurrent duplicate is refused
    // by the lock, and a repeat click after completion reuses the campaign
    // that already exists (checked inside the lock, so the check cannot race
    // a build in flight). The lock is acquired only after the ownership
    // checks above — no account can hold a lock over another's resources.
    return withOperationLock(
      {
        key: campaignBuildLockKey(uid, recommendationId),
        ownerId: uid,
        operation: 'campaign.build',
        busyMessage: CAMPAIGN_BUILD_BUSY_MESSAGE,
      },
      buildOnce,
    )

    async function buildOnce(): Promise<BuildCampaignResponse> {
      try {
        const built = await buildCampaignFromRecommendationRecord({
          uid,
          plan,
          recommendationId: recommendationId as string,
          recommendation,
          businessName: typeof business?.name === 'string' ? business.name : null,
        })
        if (built.reused) {
          return { campaignId: built.campaignId, conversationId: built.campaign.conversationId }
        }

        // Announce it in the thread it came from, if that thread still exists.
        // The recommendation itself remains untouched — traceability runs
        // Campaign → sourceRecommendationId → diagnosis → Brain.
        const conversationId = await announceCampaignInConversation(
          uid,
          built.campaignId,
          built.campaign,
          built.meta,
        )

        logger.info('Campaign built from recommendation', {
          campaignId: built.campaignId,
          recommendationId,
          conversationId,
          polished: built.meta !== null,
          model: built.meta?.model ?? null,
          latencyMs: built.meta?.latencyMs ?? null,
        })

        return { campaignId: built.campaignId, conversationId }
      } catch (error) {
        // A guardrail or validation HttpsError already carries the message the
        // user should read; wrapping it in `internal` would swallow it.
        if (error instanceof HttpsError) throw error
        throw internal('campaignBuildFromRecommendation', error)
      }
    }
  },
)

/** The lock every build of a recommendation runs under — one build, ever. */
export function campaignBuildLockKey(uid: string, recommendationId: string): string {
  return `campaign.build_${uid}_${recommendationId}`
}

export const CAMPAIGN_BUILD_BUSY_MESSAGE = 'This campaign is already being built. Give it a moment.'

export interface CampaignBuildParams {
  uid: string
  plan: SubscriptionPlan
  recommendationId: string
  /** Already ownership-checked by the caller. */
  recommendation: StoredRecommendation
  businessName: string | null
}

export interface CampaignBuildResult {
  campaignId: string
  campaign: StoredCampaign
  meta: MessageMeta | null
  /** True when a campaign for this recommendation already existed and was returned instead. */
  reused: boolean
}

export interface CampaignBuildDeps {
  findCampaignByRecommendation: typeof findCampaignByRecommendation
  runPolish: (request: StructuredRequest) => Promise<StructuredResult<unknown>>
  saveCampaign: (campaign: StoredCampaign) => Promise<string>
}

const defaultCampaignBuildDeps: CampaignBuildDeps = {
  findCampaignByRecommendation,
  runPolish: (request) => runStructuredTask<unknown>(request),
  saveCampaign,
}

/**
 * The one campaign-build pipeline: recommendation in, persisted campaign
 * out. Shared by the [Build this campaign] button and EVA's chat action
 * (Phase 7F), which creates a campaign on the owner's say-so before making
 * its posters. Must run under `campaignBuildLockKey` — the reuse check is
 * what makes a repeat idempotent, and it is only race-free inside the lock.
 * Ownership and plan resolution are the caller's job; nothing here announces
 * in chat.
 */
export async function buildCampaignFromRecommendationRecord(
  params: CampaignBuildParams,
  deps: CampaignBuildDeps = defaultCampaignBuildDeps,
): Promise<CampaignBuildResult> {
  const { uid, plan, recommendationId, recommendation } = params
  const existing = await deps.findCampaignByRecommendation(recommendationId, uid)
  if (existing) {
    logger.info('Campaign build reused', {
      recommendationId,
      campaignId: existing.id,
    })
    return { campaignId: existing.id, campaign: existing.campaign, meta: null, reused: true }
  }

  let content: CampaignContent = draftCampaignFromRecommendation(recommendation)
  let meta: MessageMeta | null = null

  try {
    const opportunity = recommendedOpportunity(recommendation)
    const polishResult = await deps.runPolish({
      task: 'campaign.build',
      uid,
      plan,
      systemPrompt: CAMPAIGN_POLISH_PROMPT,
      input: buildPolishInput({
        businessName: params.businessName,
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
    // draft is complete and honest without it. HttpsError here means the
    // usage guardrail blocked the polish call — no OpenAI spend happened,
    // so shipping the unpolished draft is the graceful degradation, not a
    // limit bypass.
    if (
      polishError instanceof HttpsError ||
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
  const campaignId = await deps.saveCampaign(stored)
  return { campaignId, campaign: stored, meta, reused: false }
}

/**
 * Writes the "campaign built" assistant turn into the thread the
 * recommendation came from, when that thread still exists and still belongs
 * to the caller. Returns the conversation id it wrote to, else null.
 */
async function announceCampaignInConversation(
  uid: string,
  campaignId: string,
  campaign: StoredCampaign,
  meta: MessageMeta | null,
): Promise<string | null> {
  if (!campaign.conversationId) return null
  const conversationRef = db.collection(COLLECTIONS.conversations).doc(campaign.conversationId)
  const conversationSnapshot = await conversationRef.get()
  if (!conversationSnapshot.exists || conversationSnapshot.data()?.ownerId !== uid) {
    return null
  }
  const presentation = buildCampaignBuiltPresentation(campaignId, campaign)
  const now = Date.now()
  const message: StoredMessage = {
    ownerId: uid,
    conversationId: campaign.conversationId,
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
  return campaign.conversationId
}
