import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https'
import { logger } from 'firebase-functions'
import {
  requireBusinessOwner,
  requireConversationOwner,
  requireUid,
  resolvePlanForUser,
} from '../lib/auth'
import type { SubscriptionPlan } from '../config/models'
import { internal, invalidArgument, notConfigured } from '../lib/errors'
import { COLLECTIONS, db, FieldValue } from '../lib/firebase'
import type {
  AssistantReplyRequest,
  AssistantReplyResponse,
  MessageBlock,
  MessageMeta,
  StoredMessage,
} from '../lib/types'
import type { StoredBusiness } from '../lib/business.types'
import { OPENAI_API_KEY } from '../ai/openai.client'
import { AiServiceError } from '../ai/errors'
import {
  AiNotConfiguredError,
  AiResponseError,
  runTask,
  type OrchestrationTurn,
} from '../ai/orchestrator'
import { buildBusinessContext } from '../ai/context'
import { buildChatSystemPrompt } from '../ai/prompts/system'
import { CHAT_HISTORY_MAX_CHARS, trimTurnsToCharBudget } from '../usage/limits'
import { buildUnavailableNote, resolveAttachmentInput } from './attachments'
import {
  applyCampaignPatch,
  generateCampaignEdit,
} from '../campaign/edit'
import {
  buildCampaignEditPresentation,
  CAMPAIGN_CLARIFICATION_REPLY,
} from '../campaign/present'
import {
  findLatestEditableCampaign,
  updateStoredCampaign,
  type StoredCampaign,
} from '../campaign/store'
import { CampaignValidationError } from '../campaign/validate'
import { resolveVisualEditImage } from '../creative/assets'
import { buildCreativeEditCorpus } from '../creative/draft'
import {
  applyCreativePatch,
  extractDirective,
  generateCreativeEdit,
  withDirective,
} from '../creative/edit'
import { buildCreativeEditPresentation } from '../creative/present'
import {
  findLatestEditableCreative,
  updateStoredCreative,
  type StoredCreative,
} from '../creative/store'
import { CreativeValidationError } from '../creative/validate'
import { assessBrainRichness } from '../marketing/grounding'
import {
  detectCampaignEdit,
  detectCreativeEdit,
  detectIntent,
  mentionsCampaign,
  mentionsCampaignConcept,
  mentionsCreative,
} from '../marketing/intent'
import { buildRecommendationPresentation, MISSING_BRAIN_REPLY } from '../marketing/present'
import { generateMarketingRecommendation } from '../marketing/recommend'
import { buildStoredRecommendation, saveRecommendation } from '../marketing/store'
import { RecommendationValidationError } from '../marketing/validate'

/** How many prior turns to send. Enough for continuity, bounded for cost. */
const HISTORY_LIMIT = 30

/** How many prior turns the marketing engine sees. Context, not evidence. */
const MARKETING_CONTEXT_TURNS = 6

/**
 * Generates MARKA's reply to a stored user message.
 *
 * The client never sends prompt text or model names — only the ids of things
 * it already owns. The function re-reads the conversation from Firestore,
 * which means a tampered client cannot inject history, impersonate another
 * business, or steer the system prompt.
 *
 * Two paths out of one door:
 *  - conversation → the fast chat tier, as before
 *  - a marketing goal → the marketing intelligence engine on the reasoning
 *    tier, which persists a structured recommendation and answers with a
 *    recommendation block
 *
 * Either way the assistant message is written server-side; security rules
 * reject any client attempt to write one, and the `recommendations`
 * collection rejects every client write outright.
 */
export const chatAssistantReply = onCall(
  {
    region: 'asia-southeast1',
    secrets: [OPENAI_API_KEY],
    /**
     * The marketing path runs the reasoning tier, whose per-request budget is
     * 110s with no retry (see config/models.ts). 180s covers that call plus
     * the Firestore reads and writes around it; models.test.ts pins the
     * arithmetic so a retimed tier cannot silently outgrow this.
     */
    timeoutSeconds: 180,
    memory: '512MiB',
    // Chat is bursty per user but low volume overall while in foundation.
    maxInstances: 10,
    cors: true,
  },
  async (request: CallableRequest<AssistantReplyRequest>): Promise<AssistantReplyResponse> => {
    const uid = requireUid(request)
    const { conversationId, businessId } = request.data ?? {}

    if (!conversationId || typeof conversationId !== 'string') {
      throw invalidArgument('A conversationId is required.')
    }

    await requireConversationOwner(conversationId, uid)

    // The plan is resolved from the server's own subscription record, once
    // per request, and threaded to every model call below. The request
    // payload has no say in it.
    const plan = await resolvePlanForUser(uid)

    // Ownership is verified before the cast; the document shape is ours.
    const business = businessId
      ? ((await requireBusinessOwner(businessId, uid)) as StoredBusiness | null)
      : null

    const conversationRef = db.collection(COLLECTIONS.conversations).doc(conversationId)
    const messagesRef = conversationRef.collection(COLLECTIONS.messages)

    // Read the tail, then restore chronological order.
    const snapshot = await messagesRef.orderBy('createdAt', 'desc').limit(HISTORY_LIMIT).get()
    const stored = snapshot.docs
      .reverse()
      .map((doc) => doc.data() as StoredMessage)
      .filter((message) => message.role === 'user' || message.role === 'assistant')

    // The 30-turn window bounds how many turns are sent; the char budget
    // bounds how big they are. Without it, thirty maximum-length messages
    // would buy a giant context on every turn of the thread (§26 abuse
    // shape). Oldest turns fall off first, like any context window.
    const history: OrchestrationTurn[] = trimTurnsToCharBudget(
      stored
        .map((message) => ({
          role: message.role as 'user' | 'assistant',
          text: message.plainText,
        }))
        .filter((turn) => turn.text.length > 0),
      CHAT_HISTORY_MAX_CHARS,
    )

    const latest = history.at(-1)
    if (!latest || latest.role !== 'user') {
      throw invalidArgument('There is nothing to reply to in this conversation.')
    }

    /** Writes MARKA's turn and updates the thread summary. */
    const writeAssistantMessage = async (
      blocks: MessageBlock[],
      plainText: string,
      meta: MessageMeta | null,
    ): Promise<string> => {
      const now = Date.now()
      const assistantMessage: StoredMessage = {
        ownerId: uid,
        conversationId,
        role: 'assistant',
        blocks,
        plainText,
        status: 'complete',
        meta,
        createdAt: now,
        updatedAt: now,
      }
      const created = await messagesRef.add(assistantMessage)
      // Atomic increment, like every other message write. The old
      // `snapshot.size + 1` was read from a HISTORY_LIMIT-capped tail, so it
      // silently froze the counter once a thread outgrew the window.
      await conversationRef.update({
        lastMessagePreview: plainText.slice(0, 140),
        messageCount: FieldValue.increment(1),
        updatedAt: now,
      })
      return created.id
    }

    // A short follow-up like "what if I target families instead?" only reads
    // as a marketing goal when MARKA's latest turn was a recommendation.
    const lastAssistant = [...stored].reverse().find((message) => message.role === 'assistant')
    const afterRecommendation = Boolean(
      lastAssistant?.blocks.some((block) => block.type === 'marketing_recommendation'),
    )

    const intent = detectIntent(latest.text, { afterRecommendation })

    try {
      // Conversational creative editing. Once marketing materials exist in
      // this thread, a generic edit instruction ("make the headline more
      // premium", "don't mention discounts") targets the *most recent
      // artifact* — the creative — unless the message names a campaign-only
      // concept (audience, duration, channels…) without naming any part of
      // the creative. Checked before the campaign branch for that reason.
      if (
        detectCreativeEdit(latest.text) &&
        !(mentionsCampaignConcept(latest.text) && !mentionsCreative(latest.text))
      ) {
        const existing = await findLatestEditableCreative(conversationId, uid)
        if (existing) {
          const assistantMessageId = await editCreativeFromChat({
            existing,
            instruction: latest.text,
            business,
            writeAssistantMessage,
            conversationId,
            uid,
            plan,
          })
          return { conversationId, assistantMessageId }
        }
        // No creative yet: fall through so the campaign branch (or normal
        // conversation) handles the instruction as before.
      }

      // Conversational campaign editing. Once a campaign exists in this
      // thread, an instruction like "make this more premium" targets it — the
      // most recently touched draft/ready campaign wins, per the product
      // rule. Checked before goal detection so a message that reads as both
      // ("target families instead") edits the campaign rather than spawning a
      // second recommendation. Costs one equality query, only on messages
      // that already look like edit instructions.
      if (detectCampaignEdit(latest.text)) {
        const existing = await findLatestEditableCampaign(conversationId, uid)

        if (existing) {
          const { draft: editDraft, meta } = await generateCampaignEdit({
            instruction: latest.text,
            campaign: existing.campaign,
            businessName: typeof business?.name === 'string' ? business.name : null,
            uid,
            plan,
          })

          // Every field this instruction changes becomes owner-set; a later
          // assistant-sourced update can never silently revert it.
          const { campaign: updated, changed } = applyCampaignPatch(
            existing.campaign,
            editDraft.patch,
            'user_instruction',
          )
          if (changed.length > 0) {
            await updateStoredCampaign(existing.id, updated)
          }

          const presentation = buildCampaignEditPresentation(
            existing.id,
            updated,
            editDraft.reply,
            changed,
          )
          const assistantMessageId = await writeAssistantMessage(
            presentation.blocks,
            presentation.plainText,
            meta,
          )

          logger.info('Campaign edited from chat', {
            conversationId,
            campaignId: existing.id,
            changed,
            model: meta.model,
            latencyMs: meta.latencyMs,
          })

          return { conversationId, assistantMessageId }
        }

        // An edit that names a campaign this thread does not have gets a
        // short, honest clarification — not a model call.
        if (mentionsCampaign(latest.text)) {
          const assistantMessageId = await writeAssistantMessage(
            [{ id: 'b0', type: 'text', text: CAMPAIGN_CLARIFICATION_REPLY }],
            CAMPAIGN_CLARIFICATION_REPLY,
            null,
          )
          logger.info('Campaign edit without a campaign', { conversationId })
          return { conversationId, assistantMessageId }
        }
        // Otherwise fall through: without a campaign, "target families
        // instead" keeps its Phase 3 meaning (a recommendation follow-up).
      }

      if (intent === 'marketing_goal') {
        // No Business Brain means no honest strategy. Say so — a canned,
        // truthful sentence beats a generic plan invented from nothing.
        if (!business || assessBrainRichness(business) === 'missing') {
          const assistantMessageId = await writeAssistantMessage(
            [{ id: 'b0', type: 'text', text: MISSING_BRAIN_REPLY }],
            MISSING_BRAIN_REPLY,
            null,
          )
          logger.info('Marketing goal without a Business Brain', { conversationId })
          return { conversationId, assistantMessageId }
        }

        const { draft, meta, richness } = await generateMarketingRecommendation({
          goal: latest.text,
          business,
          recentTurns: history.slice(0, -1).slice(-MARKETING_CONTEXT_TURNS),
          uid,
          plan,
        })

        const recommendationId = await saveRecommendation(
          buildStoredRecommendation({
            ownerId: uid,
            businessId: businessId as string,
            conversationId,
            draft,
            meta,
          }),
        )

        const presentation = buildRecommendationPresentation(recommendationId, draft)
        const assistantMessageId = await writeAssistantMessage(
          presentation.blocks,
          presentation.plainText,
          meta,
        )

        logger.info('Marketing recommendation generated', {
          conversationId,
          recommendationId,
          model: meta.model,
          latencyMs: meta.latencyMs,
          richness,
          confidence: draft.confidence,
          opportunities: draft.opportunities.length,
        })

        return { conversationId, assistantMessageId }
      }

      // Attachments on the *latest user message only* become model input.
      // Historical images are never re-sent; a message without attachment
      // blocks takes the exact text-only path this function always had.
      // `resolveAttachmentInput` cannot throw — anything unresolvable is
      // reported as skipped and the reply proceeds on text.
      const latestStoredUser = [...stored].reverse().find((message) => message.role === 'user')
      const attachmentInput = latestStoredUser
        ? await resolveAttachmentInput({ uid, conversationId, message: latestStoredUser })
        : { parts: [], skipped: [] }

      const unavailableNote = buildUnavailableNote(attachmentInput.skipped)

      const result = await runTask({
        task: 'chat.reply',
        uid,
        plan,
        systemPrompt:
          buildChatSystemPrompt(buildBusinessContext(business)) + (unavailableNote ?? ''),
        history:
          attachmentInput.parts.length > 0
            ? [...history.slice(0, -1), { ...latest, parts: attachmentInput.parts }]
            : history,
      })

      const assistantMessageId = await writeAssistantMessage(
        result.blocks,
        result.plainText,
        result.meta,
      )

      logger.info('Assistant reply generated', {
        conversationId,
        model: result.meta.model,
        latencyMs: result.meta.latencyMs,
      })

      return { conversationId, assistantMessageId }
    } catch (error) {
      // Guardrail blocks (resource-exhausted with the limit sentence) and
      // context-size rejections (invalid-argument) already carry the message
      // the owner should read; wrapping them in `internal` would swallow it.
      if (error instanceof HttpsError) throw error
      if (error instanceof AiNotConfiguredError) {
        throw notConfigured()
      }
      // The provider failure is already reduced to a safe sentence. A rate
      // limit and an exhausted quota are both `resource-exhausted` — the
      // difference an owner needs is in the sentence, not the code, and the
      // client renders the sentence. Everything else keeps the generic
      // internal error so no new failure mode leaks by default.
      if (error instanceof AiServiceError) {
        if (error.kind === 'billing' || error.kind === 'rate_limit') {
          throw new HttpsError('resource-exhausted', error.userMessage)
        }
        throw new HttpsError('internal', error.userMessage)
      }
      // The model answered, but not usably. Nothing about the response body
      // may leak; the owner just needs to know it is worth trying again.
      if (
        error instanceof AiResponseError ||
        error instanceof RecommendationValidationError ||
        error instanceof CampaignValidationError ||
        error instanceof CreativeValidationError
      ) {
        logger.warn('Recommendation output unusable', { conversationId, reason: error.message })
        throw new HttpsError('internal', 'MARKA could not finish that thought. Please try again.')
      }
      throw internal('chatAssistantReply', error)
    }
  },
)

/** Owner-facing image failure line. Provider internals never surface. */
const CREATIVE_IMAGE_ERROR_MESSAGE = 'The poster image could not be created.'

/**
 * Applies one chat instruction to the thread's latest creative.
 *
 * Copy changes go through the authority model (every field the instruction
 * touches becomes owner-set), standing constraints like "don't mention
 * discounts" are recorded as directives for every later call, and the image
 * is regenerated only when the validated edit carries a `visualChange` —
 * text-only edits never cost an image call.
 */
async function editCreativeFromChat(params: {
  existing: { id: string; creative: StoredCreative }
  instruction: string
  business: StoredBusiness | null
  conversationId: string
  /** The authenticated caller, for the usage guardrail. */
  uid: string
  /** Server-resolved subscription plan, from the callable boundary. */
  plan: SubscriptionPlan
  writeAssistantMessage: (
    blocks: MessageBlock[],
    plainText: string,
    meta: MessageMeta | null,
  ) => Promise<string>
}): Promise<string> {
  const { existing, instruction, business, conversationId, uid, plan } = params
  const creative = existing.creative

  // The campaign, for grounding and context — if it still exists. Its
  // absence degrades the corpus, never the edit.
  const campaignSnapshot = await db
    .collection(COLLECTIONS.campaigns)
    .doc(creative.campaignId)
    .get()
  const campaignData = campaignSnapshot.exists
    ? (campaignSnapshot.data() as StoredCampaign)
    : null
  const campaign = campaignData?.ownerId === creative.ownerId ? campaignData : null

  const corpus = buildCreativeEditCorpus({ creative, campaign, business, instruction })

  const { draft: editDraft, meta } = await generateCreativeEdit({
    instruction,
    creative,
    campaign,
    businessName: typeof business?.name === 'string' ? business.name : null,
    corpus,
    uid,
    plan,
  })

  // Every field this instruction changes becomes owner-set; a later
  // assistant-sourced update can never silently revert it.
  const { creative: patched, changed } = applyCreativePatch(
    creative,
    editDraft.patch,
    'user_instruction',
  )

  // "Don't mention discounts" is a standing rule, not a one-off patch: it is
  // recorded even when this edit changed nothing, so every later copy call
  // for this creative still honours it.
  const directives = withDirective(creative.ownerDirectives, extractDirective(instruction))
  const directivesChanged = directives.length !== creative.ownerDirectives.length
  let next: StoredCreative = { ...patched, ownerDirectives: directives }

  // A visual instruction touches the image; nothing else ever does. What
  // "touch" means depends on the image's source: a poster on the owner's own
  // photo keeps that photo (the Asset is re-snapshotted, never swapped for
  // AI imagery), while a generated poster regenerates from the brief.
  let imageChanged = false
  let visualNote: string | null = null
  if (editDraft.visualChange) {
    try {
      const resolved = await resolveVisualEditImage({
        creative,
        visualChange: editDraft.visualChange,
        ownerId: creative.ownerId,
        business,
        plan,
      })
      visualNote = resolved.note
      if (resolved.action === 'replaced') {
        next = {
          ...next,
          content: { ...next.content, image: resolved.image, layout: 'image_full_bleed' },
          imageError: null,
        }
        imageChanged = true
      }
    } catch (imageError) {
      // A guardrail block (HttpsError) keeps the copy edit that already
      // happened and puts its limit sentence on the image slot — the owner
      // reads why the visual did not change, and nothing applied is lost.
      if (imageError instanceof HttpsError) {
        logger.warn('Creative visual edit blocked', { creativeId: existing.id })
        next = { ...next, imageError: imageError.message }
        imageChanged = true
      } else if (
        imageError instanceof AiNotConfiguredError ||
        imageError instanceof AiServiceError ||
        imageError instanceof AiResponseError
      ) {
        logger.warn('Creative visual edit failed', {
          creativeId: existing.id,
          reason: imageError.message,
        })
        next = { ...next, imageError: CREATIVE_IMAGE_ERROR_MESSAGE }
        imageChanged = true
      } else {
        throw imageError
      }
    }
  }

  if (changed.length > 0 || directivesChanged || imageChanged) {
    next.updatedAt = Date.now()
    await updateStoredCreative(existing.id, next)
  }

  // The kept-your-photo note rides with the model's reply so the owner is
  // never told their photo was replaced when it was not.
  const reply = [editDraft.reply, visualNote].filter(Boolean).join(' ') || null
  const presentation = buildCreativeEditPresentation(existing.id, next, reply, changed)
  const assistantMessageId = await params.writeAssistantMessage(
    presentation.blocks,
    presentation.plainText,
    meta,
  )

  logger.info('Creative edited from chat', {
    conversationId,
    creativeId: existing.id,
    changed,
    directives: directives.length,
    visualChange: editDraft.visualChange !== null,
    model: meta.model,
    latencyMs: meta.latencyMs,
  })

  return assistantMessageId
}
