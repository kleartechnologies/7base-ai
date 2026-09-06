import { HttpsError } from 'firebase-functions/v2/https'
import { logger } from 'firebase-functions'
import { AiServiceError } from '../../ai/errors'
import { AiNotConfiguredError, AiResponseError } from '../../ai/orchestrator'
import {
  buildCampaignFromRecommendationRecord,
  CAMPAIGN_BUILD_BUSY_MESSAGE,
  campaignBuildLockKey,
  type CampaignBuildParams,
  type CampaignBuildResult,
} from '../../campaign/build'
import { buildCampaignCardBlock } from '../../campaign/present'
import {
  findLatestEditableCampaign,
  listEditableCampaignsForBusiness,
  type StoredCampaign,
} from '../../campaign/store'
import type { SubscriptionPlan } from '../../config/models'
import { listEligibleAssets, type AssetWithId } from '../../creative/assets'
import {
  CREATIVE_GENERATE_BUSY_MESSAGE,
  creativeGenerateLockKey,
  generateCreativeForCampaign,
  type CreativeGenerationParams,
  type CreativeGenerationResult,
} from '../../creative/generate'
import type { StoredBusiness } from '../../lib/business.types'
import { COLLECTIONS, db } from '../../lib/firebase'
import { withOperationLock } from '../../lib/operationLock'
import type {
  ActionProgressStep,
  ActionProposalBlock,
  CreativeRequestSpec,
  MessageBlock,
  MessageMeta,
  ProposedAction,
} from '../../lib/types'
import { assessBrainRichness } from '../../marketing/grounding'
import {
  generateMarketingRecommendation,
  type RecommendationOutcome,
} from '../../marketing/recommend'
import {
  buildStoredRecommendation,
  saveRecommendation,
  type StoredRecommendation,
} from '../../marketing/store'
import { RecommendationValidationError } from '../../marketing/validate'
import { peekRemainingRequests } from '../../usage/guardrail'
import {
  MAX_CREATIVES_PER_REQUEST,
  positionsFor,
  readChoice,
  type CampaignChooseAction,
  type ChatActionDecision,
  type CreativeGenerateAction,
} from './decide'
import {
  buildProposalBlock,
  campaignFailedText,
  campaignGoneText,
  missingBrainText,
  presentCreativeSetOutcome,
  presentProposal,
  presentText,
  type CreatedPoster,
  type ReplyLanguage,
} from './present'

/**
 * Phase 7F — carrying an action out.
 *
 * Every step here is an existing, secured capability with a new caller:
 * campaign resolution reads the owner's own campaigns; poster generation is
 * `generateCreativeForCampaign` under the same per-campaign lock the button
 * uses; campaign creation is the recommendation engine plus the campaign
 * build under its lock. The usage guardrail runs inside every model call as
 * it always has — this file only *asks* it, read-only, whether a promise can
 * be kept before making it. Nothing here takes an id from the client:
 * campaign ids come from proposals EVA wrote or from queries scoped to the
 * owner, and both are re-checked for ownership when loaded.
 */

/** Posters are started only while this much of the request budget is left. */
const POSTER_SOFT_DEADLINE_MS = 300_000

/** After building a campaign, posters start only if this much time remains. */
const CHAIN_SOFT_DEADLINE_MS = 240_000

/** How many campaigns EVA offers when several could be meant. */
const MAX_CAMPAIGN_CHOICES = 4

export interface ActionContext {
  uid: string
  plan: SubscriptionPlan
  conversationId: string
  businessId: string | null
  business: StoredBusiness | null
  language: ReplyLanguage
  /** The owner's latest message — the goal text when a campaign is created. */
  text: string
  /** When the request started; the soft deadlines count from here. */
  startedAt: number
  now: () => number
  onProgress: (steps: ActionProgressStep[]) => void
}

/** The seams a test replaces. Production wires the real modules below. */
export interface ActionDeps {
  loadCampaign: (campaignId: string) => Promise<StoredCampaign | null>
  findConversationCampaign: typeof findLatestEditableCampaign
  listBusinessCampaigns: typeof listEditableCampaignsForBusiness
  listEligibleAssets: (businessId: string, ownerId: string) => Promise<AssetWithId[]>
  peekRemaining: typeof peekRemainingRequests
  withLock: <T>(
    lock: { key: string; ownerId: string; operation: string; busyMessage: string },
    fn: () => Promise<T>,
  ) => Promise<T>
  generateCreative: (params: CreativeGenerationParams) => Promise<CreativeGenerationResult>
  recommend: typeof generateMarketingRecommendation
  saveRecommendation: (recommendation: StoredRecommendation) => Promise<string>
  buildCampaign: (params: CampaignBuildParams) => Promise<CampaignBuildResult>
}

export const defaultActionDeps: ActionDeps = {
  async loadCampaign(campaignId) {
    const snapshot = await db.collection(COLLECTIONS.campaigns).doc(campaignId).get()
    return snapshot.exists ? (snapshot.data() as StoredCampaign) : null
  },
  findConversationCampaign: findLatestEditableCampaign,
  listBusinessCampaigns: listEditableCampaignsForBusiness,
  listEligibleAssets,
  peekRemaining: peekRemainingRequests,
  withLock: (lock, fn) => withOperationLock(lock, fn),
  generateCreative: (params) => generateCreativeForCampaign(params),
  recommend: generateMarketingRecommendation,
  saveRecommendation,
  buildCampaign: (params) => buildCampaignFromRecommendationRecord(params),
}

export interface ActionOutcome {
  blocks: MessageBlock[]
  plainText: string
  meta: MessageMeta | null
  /** Structured facts for the function log — never shown to the owner. */
  log: Record<string, unknown>
}

export type ExecutableDecision = Exclude<ChatActionDecision, { type: 'none' }>

export async function runChatAction(
  decision: ExecutableDecision,
  ctx: ActionContext,
  deps: ActionDeps = defaultActionDeps,
): Promise<ActionOutcome> {
  switch (decision.type) {
    case 'creative_request':
      return runCreativeRequest(decision.spec, ctx, deps)
    case 'choose':
      return runCreativeGeneration(decision.action, ctx, deps, { fromProposal: true })
    case 'reask_choice':
      return outcome(presentProposal(decision.proposal, ctx.language, { kind: 'reask' }), null, {
        action: 'campaign.choose',
        reasked: true,
      })
    case 'confirm':
      return runProposedAction(decision.action, ctx, deps)
  }
}

async function runProposedAction(
  action: ProposedAction,
  ctx: ActionContext,
  deps: ActionDeps,
): Promise<ActionOutcome> {
  switch (action.kind) {
    case 'creative.generate':
      return runCreativeGeneration(action, ctx, deps, { fromProposal: true })
    case 'campaign.create':
      return runCampaignCreate(action, ctx, deps)
    case 'campaign.choose':
      return outcome(presentProposal(action, ctx.language, { kind: 'reask' }), null, {
        action: 'campaign.choose',
        reasked: true,
      })
  }
}

/* --- explicit requests: which campaign? ------------------------------------ */

async function runCreativeRequest(
  spec: CreativeRequestSpec,
  ctx: ActionContext,
  deps: ActionDeps,
): Promise<ActionOutcome> {
  const resolved = await resolveCampaign(ctx, deps)

  if (resolved.kind === 'one') {
    return runCreativeGeneration(
      {
        kind: 'creative.generate',
        campaignId: resolved.id,
        campaignName: resolved.campaign.name,
        spec,
      },
      ctx,
      deps,
      { fromProposal: false },
    )
  }

  if (resolved.kind === 'many') {
    const choose: CampaignChooseAction = {
      kind: 'campaign.choose',
      choices: resolved.choices.map((c) => ({ campaignId: c.id, name: c.campaign.name })),
      then: spec,
    }
    return outcome(presentProposal(choose, ctx.language, { kind: 'choose' }), null, {
      action: 'campaign.choose',
      choices: choose.choices.length,
    })
  }

  // No campaign anywhere: offer to create one — unless there is no Business
  // Brain to create it from, in which case say that instead.
  if (!ctx.business || assessBrainRichness(ctx.business) === 'missing') {
    return outcome(presentText(missingBrainText(ctx.language)), null, {
      action: 'creative.generate',
      blocked: 'missing_brain',
    })
  }
  const create: ProposedAction = { kind: 'campaign.create', goal: ctx.text, then: spec }
  return outcome(presentProposal(create, ctx.language, { kind: 'no_campaign' }), null, {
    action: 'campaign.create',
    proposed: true,
  })
}

type ResolvedCampaign =
  | { kind: 'one'; id: string; campaign: StoredCampaign }
  | { kind: 'many'; choices: { id: string; campaign: StoredCampaign }[] }
  | { kind: 'none' }

/**
 * The campaign a request is for: this thread's own campaign when it has
 * one; else the business's only editable campaign; else, among several, the
 * one the message names — and when none of that settles it, the newest few
 * to choose from. Every query is scoped to the owner.
 */
async function resolveCampaign(ctx: OfferContext, deps: ActionDeps): Promise<ResolvedCampaign> {
  const inThread = await deps.findConversationCampaign(ctx.conversationId, ctx.uid)
  if (inThread) return { kind: 'one', id: inThread.id, campaign: inThread.campaign }
  if (!ctx.businessId) return { kind: 'none' }

  const all = await deps.listBusinessCampaigns(ctx.businessId, ctx.uid)
  if (all.length === 0) return { kind: 'none' }
  const only = all.length === 1 ? all[0] : undefined
  if (only) return { kind: 'one', id: only.id, campaign: only.campaign }

  const named = readChoice(
    ctx.text,
    all.map((c) => ({ name: c.campaign.name })),
  )
  const chosen = named !== null ? all[named] : undefined
  if (chosen) return { kind: 'one', id: chosen.id, campaign: chosen.campaign }

  return { kind: 'many', choices: all.slice(0, MAX_CAMPAIGN_CHOICES) }
}

/* --- EVA's own offers → proposals ------------------------------------------ */

export interface OfferContext {
  uid: string
  conversationId: string
  businessId: string | null
  business: StoredBusiness | null
  language: ReplyLanguage
  /** The owner's message EVA was answering — may name the campaign. */
  text: string
}

/**
 * Turns an offer EVA made in prose ("Want me to create the 3 posters?")
 * into a proposal block on her turn, so the go-ahead that follows executes
 * it. The campaign is resolved now, server-side, from the owner's own
 * records; when there is none and there is a Business Brain, the proposal
 * is to create one first. Null when nothing could be acted on — the offer
 * then stays plain prose, which is what it was before this phase.
 */
export async function proposeFromOffer(
  offer: { count: number; format: CreativeRequestSpec['format']; brief: string | null },
  ctx: OfferContext,
  deps: ActionDeps = defaultActionDeps,
): Promise<ActionProposalBlock | null> {
  const spec: CreativeRequestSpec = {
    format: offer.format,
    brief: offer.brief,
    positions: positionsFor(offer.count),
    size: offer.count,
  }
  const resolved = await resolveCampaign(ctx, deps)
  if (resolved.kind === 'one') {
    return buildProposalBlock(
      'b1',
      {
        kind: 'creative.generate',
        campaignId: resolved.id,
        campaignName: resolved.campaign.name,
        spec,
      },
      ctx.language,
    )
  }
  if (resolved.kind === 'many') {
    return buildProposalBlock(
      'b1',
      {
        kind: 'campaign.choose',
        choices: resolved.choices.map((c) => ({ campaignId: c.id, name: c.campaign.name })),
        then: spec,
      },
      ctx.language,
    )
  }
  if (!ctx.business || assessBrainRichness(ctx.business) === 'missing') return null
  return buildProposalBlock(
    'b1',
    { kind: 'campaign.create', goal: ctx.text, then: spec },
    ctx.language,
  )
}

/** One short line describing a pending proposal, for the system prompt. */
export function describeProposal(action: ProposedAction): string {
  switch (action.kind) {
    case 'creative.generate':
      return `to create ${action.spec.positions.length} poster(s) for the campaign "${action.campaignName}"`
    case 'campaign.create':
      return action.then
        ? `to create a campaign and then ${action.then.positions.length} poster(s) for it`
        : 'to create a campaign'
    case 'campaign.choose':
      return `to create ${action.then.positions.length} poster(s) once the owner picks a campaign (${action.choices.map((c) => c.name).join(' / ')})`
  }
}

/* --- posters ------------------------------------------------------------------ */

interface PosterFailure {
  position: number
  /** The guardrail's sentence when a limit stopped this poster; null otherwise. */
  blockedMessage: string | null
}

async function runCreativeGeneration(
  action: CreativeGenerateAction,
  ctx: ActionContext,
  deps: ActionDeps,
  options: { fromProposal: boolean; campaignCreated?: { campaignId: string; campaign: StoredCampaign } },
): Promise<ActionOutcome> {
  const campaign = await deps.loadCampaign(action.campaignId)
  // A missing campaign and someone else's answer identically — the id came
  // from a proposal EVA wrote, but it is re-checked like any request id.
  if (!campaign || campaign.ownerId !== ctx.uid || campaign.status === 'archived') {
    return outcome(presentText(campaignGoneText(ctx.language)), null, {
      action: 'creative.generate',
      blocked: 'campaign_unavailable',
    })
  }
  if (ctx.businessId && campaign.businessId !== ctx.businessId) {
    return outcome(presentText(campaignGoneText(ctx.language)), null, {
      action: 'creative.generate',
      blocked: 'campaign_other_business',
    })
  }

  const positions = action.spec.positions.slice(0, MAX_CREATIVES_PER_REQUEST)
  const requestedCount = positions.length

  // Keep the promise honest before making it: an advisory look at today's
  // budget. The guardrail's transaction inside each call stays the authority.
  const [remaining, assets] = await Promise.all([
    deps.peekRemaining({ uid: ctx.uid, plan: ctx.plan }),
    deps.listEligibleAssets(campaign.businessId, ctx.uid),
  ])
  const hasPhoto = assets.some(({ asset }) => asset.type === 'product' || asset.type === 'photo')
  const affordable = Math.min(
    remaining.aiGeneration,
    hasPhoto ? Number.POSITIVE_INFINITY : remaining.imageGeneration,
  )
  if (affordable <= 0) {
    const message =
      !hasPhoto && remaining.imageGeneration <= 0 && remaining.aiGeneration > 0
        ? "You've reached today's image-generation limit. Please try again tomorrow."
        : "You've reached today's AI request limit. Please try again tomorrow."
    return outcome(presentText(message), null, {
      action: 'creative.generate',
      blocked: 'quota',
      requested: requestedCount,
    })
  }
  if (affordable < requestedCount) {
    const capped: CreativeGenerateAction = {
      ...action,
      spec: { ...action.spec, positions: positions.slice(0, affordable) },
    }
    return outcome(
      presentProposal(capped, ctx.language, { kind: 'quota_cap', requested: requestedCount }),
      null,
      { action: 'creative.generate', proposed: 'quota_cap', requested: requestedCount, affordable },
    )
  }

  // Progress: the assembly steps are real (campaign resolved, brand and
  // assets read from the owner's own records, concepts = the set context
  // each poster gets) and shown as done the moment the set starts.
  const steps: ActionProgressStep[] = [
    ...(options.campaignCreated ? [{ key: 'campaign_create', state: 'done' } as const] : []),
    { key: 'campaign', state: 'done' },
    { key: 'brand', state: 'done' },
    { key: 'assets', state: 'done' },
    { key: 'concepts', state: 'done' },
    ...positions.map(
      (_position, index): ActionProgressStep => ({
        key: 'poster',
        state: 'pending',
        index: index + 1,
        total: requestedCount,
      }),
    ),
  ]
  const posterStep = (index: number) => steps.find((s) => s.key === 'poster' && s.index === index)
  const report = () => ctx.onProgress(steps.map((s) => ({ ...s })))
  report()

  const created: CreatedPoster[] = []
  const failed: PosterFailure[] = []
  let meta: MessageMeta | null = null

  await deps.withLock(
    {
      key: creativeGenerateLockKey(ctx.uid, action.campaignId),
      ownerId: ctx.uid,
      operation: 'creative.generate',
      busyMessage: CREATIVE_GENERATE_BUSY_MESSAGE,
    },
    async () => {
      for (const [index, position] of positions.entries()) {
        const step = posterStep(index + 1)
        // Out of time for another poster: the ones made stay made, the rest
        // are offered again rather than started into a function timeout.
        if (index > 0 && ctx.now() - ctx.startedAt > POSTER_SOFT_DEADLINE_MS) {
          failed.push({ position, blockedMessage: null })
          if (step) step.state = 'failed'
          continue
        }
        // A daily limit stopped the previous poster: the next would hit it too.
        const lastBlock = failed.at(-1)?.blockedMessage
        if (lastBlock) {
          failed.push({ position, blockedMessage: lastBlock })
          if (step) step.state = 'failed'
          continue
        }

        if (step) step.state = 'active'
        report()
        try {
          const result = await deps.generateCreative({
            uid: ctx.uid,
            plan: ctx.plan,
            campaignId: action.campaignId,
            campaign,
            business: ctx.business,
            format: action.spec.format,
            setContext: buildSetContext(position, action.spec),
            avoidAssetIds: created.flatMap((p) => p.creative.assetIds ?? []),
          })
          created.push({
            position,
            creativeId: result.creativeId,
            creative: result.creative,
            copyFellBack: result.copyFellBack,
          })
          meta = meta ?? result.meta
          if (step) step.state = 'done'
        } catch (error) {
          if (step) step.state = 'failed'
          // A guardrail block carries the sentence the owner should read
          // and means the rest of the set cannot be made today either.
          if (error instanceof HttpsError && error.code === 'resource-exhausted') {
            logger.warn('Chat action poster blocked', { campaignId: action.campaignId, position })
            failed.push({ position, blockedMessage: error.message })
          } else if (
            error instanceof HttpsError ||
            error instanceof AiNotConfiguredError ||
            error instanceof AiServiceError ||
            error instanceof AiResponseError
          ) {
            logger.warn('Chat action poster failed', {
              campaignId: action.campaignId,
              position,
              reason: error.message,
            })
            failed.push({ position, blockedMessage: null })
          } else {
            // Anything else is a bug, not a poster problem: log it, keep the
            // posters already made, and report this one as not completed.
            logger.error('Chat action poster crashed', {
              campaignId: action.campaignId,
              position,
              reason: error instanceof Error ? error.message : String(error),
            })
            failed.push({ position, blockedMessage: null })
          }
        }
        report()
      }
    },
  )

  const presentation = presentCreativeSetOutcome(
    {
      campaignId: action.campaignId,
      campaignName: campaign.name,
      requested: positions,
      size: action.spec.size,
      format: action.spec.format,
      brief: action.spec.brief,
      created,
      failed: failed.map((f) => f.position),
      blockedMessage: failed.find((f) => f.blockedMessage)?.blockedMessage ?? null,
      campaignCreated: options.campaignCreated ?? null,
    },
    ctx.language,
  )
  return outcome(presentation, meta, {
    action: 'creative.generate',
    campaignId: action.campaignId,
    requested: requestedCount,
    created: created.length,
    failed: failed.length,
    fromProposal: options.fromProposal,
    creativeIds: created.map((p) => p.creativeId),
  })
}

/**
 * The line the copy call reads for one poster of a set: its position, the
 * owner's own request verbatim (so "1. English intro, 2. BM…" lands on the
 * right poster in the right language), and nothing invented.
 */
export function buildSetContext(position: number, spec: CreativeRequestSpec): string | null {
  const brief = spec.brief?.trim()
    ? `The request for this set, in the owner's words or the plan they agreed to: "${spec.brief.trim()}".`
    : null
  if (spec.size <= 1) {
    return brief ? `${brief} Follow that request within the campaign's facts.` : null
  }
  const place = `This poster is number ${position} of a set of ${spec.size} for the same campaign.`
  if (brief) {
    return `${place} ${brief} If that request lists distinct concepts or languages, this poster is concept ${position} of the list — write it in the language named for it. Otherwise give it a different angle from the other posters in the set.`
  }
  return `${place} Give it a different angle from the other posters in the set — a different benefit, moment or audience — within the campaign's facts.`
}

/* --- campaign creation ---------------------------------------------------- */

async function runCampaignCreate(
  action: Extract<ProposedAction, { kind: 'campaign.create' }>,
  ctx: ActionContext,
  deps: ActionDeps,
): Promise<ActionOutcome> {
  if (!ctx.business || !ctx.businessId || assessBrainRichness(ctx.business) === 'missing') {
    return outcome(presentText(missingBrainText(ctx.language)), null, {
      action: 'campaign.create',
      blocked: 'missing_brain',
    })
  }
  const business = ctx.business
  const businessId = ctx.businessId

  const steps: ActionProgressStep[] = [{ key: 'campaign_create', state: 'active' }]
  ctx.onProgress(steps.map((s) => ({ ...s })))

  let recommendation: RecommendationOutcome
  let recommendationId: string
  let built: CampaignBuildResult
  try {
    // The existing workflow, end to end: a recommendation the owner could
    // have asked for in words, persisted; then the campaign built from it
    // under the build lock, exactly as the button does.
    recommendation = await deps.recommend({
      goal: action.goal,
      business,
      recentTurns: [],
      uid: ctx.uid,
      plan: ctx.plan,
    })
    const stored = buildStoredRecommendation({
      ownerId: ctx.uid,
      businessId,
      conversationId: ctx.conversationId,
      draft: recommendation.draft,
      meta: recommendation.meta,
    })
    recommendationId = await deps.saveRecommendation(stored)
    built = await deps.withLock(
      {
        key: campaignBuildLockKey(ctx.uid, recommendationId),
        ownerId: ctx.uid,
        operation: 'campaign.build',
        busyMessage: CAMPAIGN_BUILD_BUSY_MESSAGE,
      },
      () =>
        deps.buildCampaign({
          uid: ctx.uid,
          plan: ctx.plan,
          recommendationId,
          recommendation: stored,
          businessName: typeof business.name === 'string' ? business.name : null,
        }),
    )
  } catch (error) {
    steps[0] = { key: 'campaign_create', state: 'failed' }
    ctx.onProgress(steps.map((s) => ({ ...s })))
    if (error instanceof HttpsError) {
      logger.warn('Chat action campaign create blocked', { conversationId: ctx.conversationId })
      return outcome(presentText(campaignFailedText(ctx.language, error.message)), null, {
        action: 'campaign.create',
        failed: 'blocked',
      })
    }
    if (
      error instanceof AiNotConfiguredError ||
      error instanceof AiServiceError ||
      error instanceof AiResponseError ||
      error instanceof RecommendationValidationError
    ) {
      logger.warn('Chat action campaign create failed', {
        conversationId: ctx.conversationId,
        reason: error.message,
      })
      return outcome(presentText(campaignFailedText(ctx.language, null)), null, {
        action: 'campaign.create',
        failed: 'model',
      })
    }
    throw error
  }

  const campaignCreated = { campaignId: built.campaignId, campaign: built.campaign }
  logger.info('Chat action campaign created', {
    conversationId: ctx.conversationId,
    campaignId: built.campaignId,
    recommendationId,
    reused: built.reused,
  })

  if (!action.then) {
    const lead =
      ctx.language === 'ms'
        ? `Siap — saya dah buat kempen “${built.campaign.name}”. Semuanya boleh diubah; beritahu saya apa yang nak ditukar.`
        : `Done — I created the campaign “${built.campaign.name}”. Everything is editable — tell me what to change.`
    return outcome(
      {
        blocks: [
          { id: 'b0', type: 'text', text: lead },
          { ...campaignCardOf(campaignCreated), id: 'b1' },
        ],
        plainText: `${lead}\n\nCampaign: ${built.campaign.name}`,
      },
      built.meta,
      { action: 'campaign.create', campaignId: built.campaignId, then: null },
    )
  }

  const next: CreativeGenerateAction = {
    kind: 'creative.generate',
    campaignId: built.campaignId,
    campaignName: built.campaign.name,
    spec: action.then,
  }

  // Not enough of the request budget left for the posters: hand over the
  // campaign now and offer the posters as the next go-ahead.
  if (ctx.now() - ctx.startedAt > CHAIN_SOFT_DEADLINE_MS) {
    const proposal = presentProposal(next, ctx.language, { kind: 'campaign_ready' })
    return outcome(
      {
        blocks: [
          proposal.blocks[0] as MessageBlock,
          { ...campaignCardOf(campaignCreated), id: 'b1' },
          { ...(proposal.blocks[1] as MessageBlock), id: 'b2' },
        ],
        plainText: `${proposal.plainText}\n\nCampaign: ${built.campaign.name}`,
      },
      built.meta,
      { action: 'campaign.create', campaignId: built.campaignId, then: 'deferred' },
    )
  }

  const posters = await runCreativeGeneration(next, ctx, deps, {
    fromProposal: true,
    campaignCreated,
  })
  return { ...posters, meta: posters.meta ?? built.meta }
}

function campaignCardOf(created: { campaignId: string; campaign: StoredCampaign }): MessageBlock {
  return buildCampaignCardBlock('b1', created.campaignId, created.campaign)
}

function outcome(
  presentation: { blocks: MessageBlock[]; plainText: string },
  meta: MessageMeta | null,
  log: Record<string, unknown>,
): ActionOutcome {
  return { blocks: presentation.blocks, plainText: presentation.plainText, meta, log }
}
