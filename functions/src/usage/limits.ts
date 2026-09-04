import { estimateCostUsd, type AiTask, type SubscriptionPlan } from '../config/models'

/**
 * Phase 6B — the usage guardrail's numbers and arithmetic.
 *
 * Everything in this file is pure: limits, category routing, the reservation
 * estimate, and the two state-transition functions (`applyReservation`,
 * `applySettlement`) that the Firestore transaction in guardrail.ts runs.
 * Keeping the arithmetic pure is what makes the concurrency behaviour
 * testable in Vitest without an emulator.
 *
 * The model is reservation-then-settlement:
 *
 *   1. BEFORE OpenAI, a transaction checks every limit and reserves the
 *      request's worst case (estimated input + the tier's full output
 *      ceiling, priced at the resolved model's pinned rates).
 *   2. AFTER OpenAI, a second transaction releases the reservation and books
 *      what the provider actually reported. A failed call books zero tokens
 *      but keeps its request count — a failing loop must run out of requests,
 *      not run up tokens.
 *
 * Reservations are what make concurrent requests safe: two requests racing
 * for the last slot both try to reserve it, the transaction serialises them,
 * and exactly one wins. Limits are therefore enforced at reservation time,
 * against (actuals + outstanding reservations + this request's worst case).
 */

/* --- categories --------------------------------------------------------- */

/**
 * The four spend surfaces the brief requires to be tracked separately.
 * Request counts are per-category; token budgets are shared across the text
 * categories; image tokens are booked to their own counters and never mixed
 * into the text budget.
 */
export type UsageCategory = 'chat' | 'websiteAnalysis' | 'aiGeneration' | 'imageGeneration'

export const CATEGORY_FOR_TASK: Record<AiTask, UsageCategory> = {
  'chat.reply': 'chat',
  'business.analyse_website': 'websiteAnalysis',
  // Everything that turns strategy into artefacts — recommendations,
  // campaigns, creative copy and their edits — shares one generation bucket.
  'campaign.diagnose': 'aiGeneration',
  'campaign.generate': 'aiGeneration',
  'campaign.build': 'aiGeneration',
  'campaign.edit': 'aiGeneration',
  'creative.generate_copy': 'aiGeneration',
  'creative.edit': 'aiGeneration',
  'creative.generate_image': 'imageGeneration',
}

/* --- per-plan daily limits ---------------------------------------------- */

export interface PlanGuardrails {
  /** Daily request counts, per category. Consumed on attempt, success or not. */
  requests: Record<UsageCategory, number>
  /** Daily text-model input tokens (actuals + outstanding reservations). */
  dailyInputTokens: number
  /** Daily text-model output tokens, tracked independently of input. */
  dailyOutputTokens: number
  /** A third belt across both axes; deliberately less than in + out. */
  dailyTotalTokens: number
  /** Daily estimated spend ceiling across ALL calls, images included. */
  dailyCostUsd: number
  /** Max AI calls in flight at once (see the staleness reset below). */
  maxConcurrent: number
}

/**
 * Beta-safe daily limits. Sized so that no behaviour the product actually
 * supports hits them, while a runaway loop or scripted abuse hits them fast.
 *
 * Basic (all text on gpt-5.6-luna, $0.20/$1.20 per 1M):
 *   - 100 chat turns is a message every ~5 minutes for an 8-hour day.
 *   - 5 website analyses covers onboarding plus re-analysis and retries for
 *     a product where analysis is a once-per-business event.
 *   - 25 generations ≈ a full day of recommendations, builds, copy and edits.
 *   - 10 images at ~$0.05/poster (medium quality ≈ 1.6k output tokens).
 *   Worst-case legitimate day at pinned rates: 1M input ($0.20) + 400k
 *   output ($0.48) + 10 images (~$0.60) ≈ $1.30 — so the $2 cost ceiling is
 *   a backstop behind the token limits, not the thing users feel.
 *
 * Pro (reasoning on gpt-5.6-sol $4/$20, chat on gpt-5.6-terra $2/$12):
 *   All-reasoning worst case on 2M in / 800k out would be $24, so for Pro the
 *   $10 cost ceiling is deliberately the binding constraint on
 *   reasoning-heavy days — a realistic mixed day lands at $3–6. Raising the
 *   ceiling later is a one-line change; an unbounded beta bill is not.
 *
 * dailyTotalTokens is intentionally below input + output: a day that maxes
 * both axes simultaneously is not a shape legitimate use produces.
 */
export const GUARDRAIL_LIMITS: Record<SubscriptionPlan, PlanGuardrails> = {
  basic: {
    requests: { chat: 100, websiteAnalysis: 5, aiGeneration: 25, imageGeneration: 10 },
    dailyInputTokens: 1_000_000,
    dailyOutputTokens: 400_000,
    dailyTotalTokens: 1_200_000,
    dailyCostUsd: 2,
    maxConcurrent: 4,
  },
  pro: {
    requests: { chat: 250, websiteAnalysis: 10, aiGeneration: 60, imageGeneration: 25 },
    dailyInputTokens: 2_000_000,
    dailyOutputTokens: 800_000,
    dailyTotalTokens: 2_400_000,
    dailyCostUsd: 10,
    maxConcurrent: 8,
  },
}

/* --- per-request context ceilings ---------------------------------------- */

/**
 * Hard per-request prompt-size ceilings, in characters, enforced BEFORE any
 * reservation. These are shaped by what each task can legitimately send —
 * every figure is at least 3x the largest prompt the product itself builds —
 * so they never touch a real user and stop a forged or runaway payload from
 * buying a 1M-token context window at the model's input rate.
 *
 * Legitimate maxima they are sized against:
 *   - chat.reply: system prompt + bounded Brain context + history (trimmed to
 *     CHAT_HISTORY_MAX_CHARS below) ≈ 75k chars worst case.
 *   - business.analyse_website: crawl corpus is budgeted to 24k chars
 *     (sliced ≤ 28k) plus prompt overhead.
 *   - the transformation tasks carry one structured object plus a bounded
 *     instruction — tens of kilobytes at most.
 *   - creative.generate_image prompts are built from structured Creative
 *     fields and are a few hundred characters.
 */
export const MAX_REQUEST_CHARS: Record<AiTask, number> = {
  'chat.reply': 120_000,
  'business.analyse_website': 160_000,
  'campaign.diagnose': 80_000,
  'campaign.generate': 80_000,
  'campaign.build': 60_000,
  'campaign.edit': 60_000,
  'creative.generate_copy': 60_000,
  'creative.edit': 60_000,
  'creative.generate_image': 10_000,
}

/**
 * Character budget for the chat history sent to the model. The existing
 * 30-turn window bounds turn *count* but not turn *size*; this bounds the
 * bytes. ~60k chars ≈ 15k tokens ≈ $0.003 on Luna / $0.03 on Terra per turn
 * — comfortably above any real conversation window, far below abuse scale.
 */
export const CHAT_HISTORY_MAX_CHARS = 60_000

/**
 * Trims `turns` to the char budget by dropping oldest-first, mirroring how
 * context windows forget. The newest turn always survives — if it alone
 * busts the budget, the per-request ceiling is the layer that rejects it
 * with a proper "too large" message rather than silently deleting it here.
 */
export function trimTurnsToCharBudget<T extends { text: string }>(
  turns: readonly T[],
  budget: number,
): T[] {
  const kept: T[] = []
  let used = 0
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    const turn = turns[i]
    if (turn === undefined) continue
    if (kept.length > 0 && used + turn.text.length > budget) break
    kept.unshift(turn)
    used += turn.text.length
  }
  return kept
}

/* --- reservation estimation ---------------------------------------------- */

/** What one request asks the guardrail to set aside before OpenAI runs. */
export interface UsageReservation {
  category: UsageCategory
  /** Estimated text input tokens (0 for image calls — tracked separately). */
  inputTokens: number
  /** The tier's output ceiling — the true worst case (0 for image calls). */
  outputTokens: number
  /** Worst-case cost at pinned rates; 0 when the model's price is unknown. */
  costUsd: number
}

/**
 * Reservation-only token heuristics. Actual billing truth always comes from
 * the provider's usage report at settlement; these only need to be close
 * enough that a burst of concurrent requests cannot slip far past a budget.
 * ~4 chars/token is the standard prose ratio; attachment parts reserve flat
 * conservative figures because their token cost is invisible until billed.
 */
const CHARS_PER_TOKEN = 4
const IMAGE_PART_TOKENS = 1_100
const FILE_PART_TOKENS = 20_000

/**
 * Output-token reservation for one generated image. A medium-quality
 * 1024x1536 render bills ≈ 1.6k image output tokens; 2,000 ≈ $0.06 at the
 * pinned $30/1M image-output rate.
 */
const IMAGE_OUTPUT_TOKENS_RESERVED = 2_000

export function buildUsageReservation(args: {
  task: AiTask
  model: string
  maxOutputTokens: number
  promptChars: number
  imageParts?: number
  fileParts?: number
}): UsageReservation {
  const category = CATEGORY_FOR_TASK[args.task]
  const promptTokens =
    Math.ceil(args.promptChars / CHARS_PER_TOKEN) +
    (args.imageParts ?? 0) * IMAGE_PART_TOKENS +
    (args.fileParts ?? 0) * FILE_PART_TOKENS

  if (category === 'imageGeneration') {
    // Image tokens live outside the text budgets; the request count and the
    // cost reservation are what protect this category.
    return {
      category,
      inputTokens: 0,
      outputTokens: 0,
      costUsd:
        estimateCostUsd(args.model, {
          inputTokens: promptTokens,
          outputTokens: IMAGE_OUTPUT_TOKENS_RESERVED,
        }) ?? 0,
    }
  }

  return {
    category,
    inputTokens: promptTokens,
    outputTokens: args.maxOutputTokens,
    costUsd:
      estimateCostUsd(args.model, {
        inputTokens: promptTokens,
        outputTokens: args.maxOutputTokens,
      }) ?? 0,
  }
}

/* --- the usage document -------------------------------------------------- */

/** One user-day of AI usage: usage/{uid}_{YYYY-MM-DD}, UTC. */
export interface UsageDoc {
  ownerId: string
  period: string
  /** The plan that was current at last write — informational, not enforced from here. */
  plan: SubscriptionPlan
  requests: Record<UsageCategory, number>
  /** Actual text-model tokens, from provider usage reports. */
  inputTokens: number
  outputTokens: number
  cachedInputTokens: number
  /** Actual image-model tokens, tracked apart from the text budget. */
  imageInputTokens: number
  imageOutputTokens: number
  /** Images that actually came back (requests.imageGeneration counts attempts). */
  imagesGenerated: number
  /** Outstanding worst-case reservations for in-flight calls. */
  reservedInputTokens: number
  reservedOutputTokens: number
  reservedCostUsd: number
  /** Actual estimated spend, at pinned rates, settled calls only. */
  estimatedCostUsd: number
  /** In-flight call count; self-heals via the staleness reset. */
  inflight: number
  /** When the newest reservation was taken — drives the staleness reset. */
  lastReserveAt: number
  createdAt: number
  updatedAt: number
}

export function dailyPeriodKeyUtc(now: number): string {
  return new Date(now).toISOString().slice(0, 10)
}

export function usageDocId(uid: string, period: string): string {
  return `${uid}_${period}`
}

export function emptyUsageDoc(args: {
  uid: string
  plan: SubscriptionPlan
  period: string
  now: number
}): UsageDoc {
  return {
    ownerId: args.uid,
    period: args.period,
    plan: args.plan,
    requests: { chat: 0, websiteAnalysis: 0, aiGeneration: 0, imageGeneration: 0 },
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    imageInputTokens: 0,
    imageOutputTokens: 0,
    imagesGenerated: 0,
    reservedInputTokens: 0,
    reservedOutputTokens: 0,
    reservedCostUsd: 0,
    estimatedCostUsd: 0,
    inflight: 0,
    lastReserveAt: 0,
    createdAt: args.now,
    updatedAt: args.now,
  }
}

/* --- reservation / settlement transitions -------------------------------- */

export type BlockReason =
  | 'request_limit'
  | 'image_limit'
  | 'token_limit'
  | 'cost_limit'
  | 'concurrency'

/**
 * What the user reads when a limit blocks them. Deliberately calm and
 * deliberately unspecific about internals — no token counts, no dollar
 * figures, no plan mechanics.
 */
export const BLOCK_MESSAGES: Record<BlockReason, string> = {
  request_limit: "You've reached today's AI request limit. Please try again tomorrow.",
  image_limit: "You've reached today's image-generation limit. Please try again tomorrow.",
  token_limit: 'Your AI usage limit for today has been reached. Please try again tomorrow.',
  cost_limit: 'Your AI usage limit for today has been reached. Please try again tomorrow.',
  concurrency: 'Too many AI requests are running at once. Please wait a moment and try again.',
}

/** §31's message for the pre-reservation context-size rejection. */
export const CONTEXT_TOO_LARGE_MESSAGE =
  'This request is too large to process. Try sending a smaller message.'

/**
 * Every function timeout in the product is ≤ 300s, so a reservation that has
 * seen no sibling activity for 10 minutes belongs to a call that died before
 * settling (crashed instance, hard timeout). The reset forgives it rather
 * than locking the user out for the rest of the day. It fires only when
 * NOTHING has reserved recently, so it can never erase a live reservation.
 */
export const STALE_INFLIGHT_MS = 10 * 60_000

export type ReservationOutcome =
  | { allowed: true; doc: UsageDoc }
  | { allowed: false; reason: BlockReason }

/**
 * The decision. Given the current usage doc (or null on first request of the
 * day) and one reservation, either returns the next doc state with the
 * reservation taken, or the reason it must be blocked. Pure — the Firestore
 * transaction just persists what this returns.
 */
export function applyReservation(
  current: UsageDoc | null,
  args: {
    uid: string
    plan: SubscriptionPlan
    period: string
    reservation: UsageReservation
    now: number
  },
): ReservationOutcome {
  const limits = GUARDRAIL_LIMITS[args.plan]
  const r = args.reservation
  let doc = current ?? emptyUsageDoc({ uid: args.uid, plan: args.plan, period: args.period, now: args.now })

  // Staleness reset: a dead call's reservation must not haunt the day.
  if (
    doc.inflight > 0 &&
    doc.lastReserveAt > 0 &&
    args.now - doc.lastReserveAt > STALE_INFLIGHT_MS
  ) {
    doc = {
      ...doc,
      inflight: 0,
      reservedInputTokens: 0,
      reservedOutputTokens: 0,
      reservedCostUsd: 0,
    }
  }

  // 1. Request count for this category — the coarse layer.
  if (doc.requests[r.category] + 1 > limits.requests[r.category]) {
    return {
      allowed: false,
      reason: r.category === 'imageGeneration' ? 'image_limit' : 'request_limit',
    }
  }

  // 2. Concurrency cap.
  if (doc.inflight + 1 > limits.maxConcurrent) {
    return { allowed: false, reason: 'concurrency' }
  }

  // 3. Token budgets: actuals plus everything currently promised.
  const inputAfter = doc.inputTokens + doc.reservedInputTokens + r.inputTokens
  const outputAfter = doc.outputTokens + doc.reservedOutputTokens + r.outputTokens
  if (
    inputAfter > limits.dailyInputTokens ||
    outputAfter > limits.dailyOutputTokens ||
    inputAfter + outputAfter > limits.dailyTotalTokens
  ) {
    return { allowed: false, reason: 'token_limit' }
  }

  // 4. Cost ceiling, across every category including images.
  if (doc.estimatedCostUsd + doc.reservedCostUsd + r.costUsd > limits.dailyCostUsd) {
    return { allowed: false, reason: 'cost_limit' }
  }

  return {
    allowed: true,
    doc: {
      ...doc,
      plan: args.plan,
      requests: { ...doc.requests, [r.category]: doc.requests[r.category] + 1 },
      reservedInputTokens: doc.reservedInputTokens + r.inputTokens,
      reservedOutputTokens: doc.reservedOutputTokens + r.outputTokens,
      reservedCostUsd: doc.reservedCostUsd + r.costUsd,
      inflight: doc.inflight + 1,
      lastReserveAt: args.now,
      updatedAt: args.now,
    },
  }
}

/** What the provider actually reported once the call finished (or zeros on failure). */
export interface UsageActual {
  inputTokens: number
  outputTokens: number
  cachedInputTokens: number
  imageInputTokens: number
  imageOutputTokens: number
  costUsd: number
  imageGenerated: boolean
}

export const ZERO_ACTUAL: UsageActual = {
  inputTokens: 0,
  outputTokens: 0,
  cachedInputTokens: 0,
  imageInputTokens: 0,
  imageOutputTokens: 0,
  costUsd: 0,
  imageGenerated: false,
}

/**
 * Releases the reservation and books reality. Floors at zero so a settlement
 * after a staleness reset (or across a UTC midnight) can never drive
 * counters negative and mint budget for someone else. The request count is
 * deliberately NOT released — the attempt happened.
 */
export function applySettlement(
  current: UsageDoc,
  args: { reservation: UsageReservation; actual: UsageActual; now: number },
): UsageDoc {
  const { reservation: r, actual: a } = args
  return {
    ...current,
    inputTokens: current.inputTokens + a.inputTokens,
    outputTokens: current.outputTokens + a.outputTokens,
    cachedInputTokens: current.cachedInputTokens + a.cachedInputTokens,
    imageInputTokens: current.imageInputTokens + a.imageInputTokens,
    imageOutputTokens: current.imageOutputTokens + a.imageOutputTokens,
    imagesGenerated: current.imagesGenerated + (a.imageGenerated ? 1 : 0),
    estimatedCostUsd: Number((current.estimatedCostUsd + a.costUsd).toFixed(6)),
    reservedInputTokens: Math.max(0, current.reservedInputTokens - r.inputTokens),
    reservedOutputTokens: Math.max(0, current.reservedOutputTokens - r.outputTokens),
    reservedCostUsd: Math.max(0, Number((current.reservedCostUsd - r.costUsd).toFixed(6))),
    inflight: Math.max(0, current.inflight - 1),
    updatedAt: args.now,
  }
}
