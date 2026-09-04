/**
 * Centralised model configuration.
 *
 * Model IDs appear here and nowhere else. Swapping the reasoning model, or
 * pointing a task at a cheaper one, is a change to this file — never a
 * find-and-replace across prompts and handlers.
 *
 * Override any tier at deploy time with an environment variable, so a model
 * can be changed without a code release.
 *
 * IDs below were verified against the official OpenAI model documentation
 * (developers.openai.com/api/docs/models) on 2026-08-30. All three text models
 * share a ~1.05M token context window and support the Responses API.
 * Re-verify before assuming they are still current.
 */

/** What a task needs from a model, not which model it gets. */
export type ModelTier = 'reasoning' | 'fast' | 'image'

/**
 * What the account pays for, not what the task needs. The two axes are
 * deliberately independent: the tier decides the operational envelope
 * (timeouts, output ceilings, retries — a reasoning call needs minutes
 * whichever model runs it), and the plan decides which model fills it.
 *
 * 'basic' is the floor, not a punishment: it runs every task the product has
 * on the low-cost model. 'pro' buys the flagship exactly where judgement is
 * the product — the reasoning tier — and stays on the mid tier for
 * transformations, because paying flagship rates to reword a decision that
 * was already made would be cost without quality.
 */
export type SubscriptionPlan = 'basic' | 'pro'

/**
 * The fail-safe. Every unknown, missing, malformed or failed plan lookup
 * lands here — an account must never be able to fall *upward* into Pro.
 */
export const DEFAULT_PLAN: SubscriptionPlan = 'basic'

export interface ModelConfig {
  /** The provider's model identifier. */
  model: string
  /** Ceiling on output size. Guards against runaway cost. */
  maxOutputTokens: number
  /** Null for models that do not accept a temperature (e.g. reasoning models). */
  temperature: number | null
  /**
   * Per-request deadline. A reasoning tier needs minutes where a chat turn
   * needs seconds, so one global timeout is wrong for both: too tight, and
   * every deep task fails; too loose, and a hung chat turn blocks the caller.
   */
  timeoutMs: number
  /**
   * Retries for this tier. Retrying is cheap when a call fails fast (429, 5xx)
   * and expensive when it times out, so the budget is set per tier such that
   * `timeoutMs * (maxRetries + 1)` still fits inside the calling function's
   * own deadline.
   */
  maxRetries: number
}

const DEFAULTS: Record<ModelTier, ModelConfig> = {
  /**
   * Marketing diagnosis, strategy, campaign structure. Quality over cost.
   *
   * GPT-5.6 Sol is the current flagship for complex professional work
   * ($4/$20 per 1M tokens). The cap is generous because reasoning tokens are
   * billed as output — too low a ceiling truncates the answer, not the cost.
   */
  reasoning: {
    model: 'gpt-5.6-sol',
    /**
     * Measured against a real six-page restaurant crawl: the Business Brain
     * schema has eleven required sections and consumed 8,607 output tokens,
     * of which 1,466 were reasoning. The previous 8,192 ceiling truncated it,
     * and a truncated structured response is discarded whole. This leaves
     * roughly 2x headroom for sites with longer menus.
     */
    maxOutputTokens: 16384,
    temperature: null,
    /**
     * That same call took 72-79s end to end, and the Phase 3 live smoke test
     * measured real marketing diagnoses at 31-47s — but its "I want more
     * customers." turn hit the previous 110s deadline exactly and then
     * succeeded on retry in 44s. 150s trades a slower failure for far fewer
     * false timeouts, and still fits every caller's deadline: see
     * models.test.ts for the arithmetic against the 300s analysis budget and
     * the 180s chat budget.
     */
    timeoutMs: 150_000,
    /**
     * Zero, deliberately. The Phase 2 latency investigation showed that
     * retrying a 110s reasoning timeout (2 x 110s = 220s) plus the 45s crawl
     * budget can blow the analysis function's 300s deadline — the retry then
     * dies with the function and the owner pays for two attempts and gets
     * neither. A reasoning call that times out fails fast to the caller
     * instead; transient fast-fail errors (429, 5xx) are rare enough on this
     * once-per-business path that the lost retry is the cheaper trade.
     */
    maxRetries: 0,
  },
  /**
   * Chat turns, titles, summaries, classification. High volume, lower cost.
   *
   * GPT-5.6 Terra is the mid tier ($2/$12 per 1M) and the direct successor to
   * the previous mini-class model. Chat is MARKA's main surface and needs real
   * marketing judgement, so this tier is deliberately not the cheapest one.
   * For genuinely trivial work, `gpt-5.6-luna` is ~10x cheaper ($0.20/$1.20)
   * and can be selected per deploy via MARKA_MODEL_FAST.
   */
  fast: {
    model: 'gpt-5.6-terra',
    maxOutputTokens: 2048,
    temperature: null,
    /** Chat turns are short; a slow one is better failed and retried. */
    timeoutMs: 60_000,
    maxRetries: 2,
  },
  /**
   * Poster and social creative image generation.
   *
   * GPT-Image-2 serves /v1/images/generations and /v1/images/edits — it is
   * not a Responses API model, so it goes through `runImageTask` rather than
   * `runTask`. `maxOutputTokens` and `temperature` do not apply to it.
   */
  image: {
    model: 'gpt-image-2',
    maxOutputTokens: 0,
    temperature: null,
    timeoutMs: 120_000,
    maxRetries: 1,
  },
}

const ENV_OVERRIDES: Record<ModelTier, string> = {
  reasoning: 'MARKA_MODEL_REASONING',
  fast: 'MARKA_MODEL_FAST',
  image: 'MARKA_MODEL_IMAGE',
}

export function getModelConfig(tier: ModelTier): ModelConfig {
  const base = DEFAULTS[tier]
  const override = process.env[ENV_OVERRIDES[tier]]
  return override ? { ...base, model: override } : base
}

/* --- plan-aware model selection ----------------------------------------- */

/**
 * Which model id each plan runs on each text tier.
 *
 * Pro's defaults are the tier defaults above — Pro *is* the behaviour MARKA
 * shipped with (flagship reasoning, mid-tier chat). Basic runs everything on
 * GPT-5.6 Luna ($0.20/$1.20 per 1M — ~20x cheaper than Sol on both sides),
 * which is what makes an RM19.90/month plan able to include real campaign
 * generation at all. The image tier is deliberately absent: both plans share
 * one image model, priced and configured once.
 */
const PLAN_MODEL_DEFAULTS: Record<SubscriptionPlan, Record<'reasoning' | 'fast', string>> = {
  basic: {
    reasoning: 'gpt-5.6-luna',
    fast: 'gpt-5.6-luna',
  },
  pro: {
    reasoning: DEFAULTS.reasoning.model,
    fast: DEFAULTS.fast.model,
  },
}

/**
 * Per-plan, per-tier deploy-time overrides. Precedence, most specific wins:
 *
 *   MARKA_MODEL_<PLAN>_<TIER>  >  MARKA_MODEL_<TIER>  >  default above
 *
 * The middle rung keeps the pre-plan variables meaningful: a deployment that
 * sets MARKA_MODEL_REASONING still moves every plan's reasoning calls, exactly
 * as it did before plans existed. Note the consequence: while a legacy
 * variable is set, it also overrides Basic's cheap default — remove it (or set
 * the plan-specific pair) to get per-plan pricing.
 */
const PLAN_ENV_OVERRIDES: Record<SubscriptionPlan, Record<'reasoning' | 'fast', string>> = {
  basic: {
    reasoning: 'MARKA_MODEL_BASIC_REASONING',
    fast: 'MARKA_MODEL_BASIC_FAST',
  },
  pro: {
    reasoning: 'MARKA_MODEL_PRO_REASONING',
    fast: 'MARKA_MODEL_PRO_FAST',
  },
}

/**
 * Runtime guard behind the type: plan values originate in Firestore documents
 * and environment variables, so a junk value must degrade to Basic rather
 * than throw or, worse, resolve generously.
 */
function normalisePlanValue(plan: unknown): SubscriptionPlan {
  return plan === 'pro' ? 'pro' : DEFAULT_PLAN
}

/** The model id `plan` runs on `tier`, after env overrides. */
function resolveModelId(tier: ModelTier, plan: SubscriptionPlan): string {
  // One image model for everyone — plan differentiation is a text-model
  // decision in this product, and image pricing/config stays in one place.
  if (tier === 'image') return getModelConfig('image').model

  const planOverride = process.env[PLAN_ENV_OVERRIDES[plan][tier]]
  if (planOverride) return planOverride
  const tierOverride = process.env[ENV_OVERRIDES[tier]]
  if (tierOverride) return tierOverride
  return PLAN_MODEL_DEFAULTS[plan][tier]
}

/**
 * Which tier each MARKA task runs on.
 *
 * This is the routing table. It is intentionally a plain map rather than a
 * rules engine: real routing (fall back on rate limit, escalate on low
 * confidence, budget per account) belongs in the orchestrator once there are
 * enough tasks to justify it.
 */
export type AiTask =
  | 'chat.reply'
  | 'business.analyse_website'
  | 'campaign.diagnose'
  | 'campaign.generate'
  | 'campaign.build'
  | 'campaign.edit'
  | 'creative.generate_copy'
  | 'creative.edit'
  | 'creative.generate_image'

const TASK_TIERS: Record<AiTask, ModelTier> = {
  // Reading a website and deciding what is fact, inference and unknown is a
  // judgement task, and it happens once per business — quality over cost.
  'chat.reply': 'fast',
  'business.analyse_website': 'reasoning',
  'campaign.diagnose': 'reasoning',
  'campaign.generate': 'reasoning',
  // Turning a recommendation into a campaign, and applying one owner
  // instruction to it, are transformations of strategy already decided (and
  // already paid for) on the reasoning tier — fast tier, by design.
  'campaign.build': 'fast',
  'campaign.edit': 'fast',
  // Creative copy inherits the campaign's strategy — the strategic decision
  // was already made (and paid for) on the reasoning tier. Fast, by design.
  'creative.generate_copy': 'fast',
  'creative.edit': 'fast',
  'creative.generate_image': 'image',
}

/**
 * The single model-selection seam: task + plan in, full model config out.
 *
 * The plan the caller passes here must be the one the server resolved from
 * its own subscription record (see lib/auth.ts) — never a value from a client
 * payload. Nothing a client sends can reach this function's `plan` argument,
 * which is what makes "a Basic user edits the request to say pro" a no-op.
 */
export function resolveModelForTask(task: AiTask, plan: SubscriptionPlan): ModelConfig {
  const tier = TASK_TIERS[task]
  const safePlan = normalisePlanValue(plan)
  return { ...getModelConfig(tier), model: resolveModelId(tier, safePlan) }
}

/**
 * USD per 1M tokens, for the telemetry's cost estimate and the Phase 6B usage
 * guardrail's cost reservations. Re-verified against the official OpenAI
 * pricing page (developers.openai.com/api/docs/pricing) on 2026-09-04
 * alongside the model IDs above. A model missing here produces a null
 * estimate rather than a wrong one — telemetry must never invent a price,
 * for the same reason MARKA's copy never does.
 *
 * `cachedInput` is the discounted rate for prompt-cache hits (10% of the
 * input rate on every current text model). `input`/`output` on gpt-image-2
 * are its *text input* ($5) and *image output* ($30) rates — the only two
 * MARKA pays, because every image call is a text-prompt generation
 * (`/v1/images/generations`); the $8 image-input rate would only apply to
 * reference-image edits, which the product does not make.
 */
const PRICING_PER_MILLION_USD: Record<
  string,
  { input: number; cachedInput: number; output: number }
> = {
  'gpt-5.6-sol': { input: 4, cachedInput: 0.4, output: 20 },
  'gpt-5.6-terra': { input: 2, cachedInput: 0.2, output: 12 },
  'gpt-5.6-luna': { input: 0.2, cachedInput: 0.02, output: 1.2 },
  'gpt-image-2': { input: 5, cachedInput: 2, output: 30 },
}

/**
 * Rough request cost in USD, or null when the model's price is not pinned.
 *
 * `cachedInputTokens` (when the provider reports it) is the portion of
 * `inputTokens` that hit the prompt cache — a subset, not an addition — so it
 * is billed at the cached rate and subtracted from the full-rate portion.
 * Omitting it never under-counts; it only prices cache hits at full rate.
 */
export function estimateCostUsd(
  model: string,
  usage: { inputTokens: number; outputTokens: number; cachedInputTokens?: number } | null,
): number | null {
  if (!usage) return null
  const price = PRICING_PER_MILLION_USD[model]
  if (!price) return null
  const cached = Math.min(Math.max(usage.cachedInputTokens ?? 0, 0), usage.inputTokens)
  const usd =
    ((usage.inputTokens - cached) / 1_000_000) * price.input +
    (cached / 1_000_000) * price.cachedInput +
    (usage.outputTokens / 1_000_000) * price.output
  return Number(usd.toFixed(6))
}
