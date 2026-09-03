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

export function resolveModelForTask(task: AiTask): ModelConfig {
  return getModelConfig(TASK_TIERS[task])
}

/**
 * USD per 1M tokens, for the telemetry's cost estimate. Verified against the
 * OpenAI pricing page on 2026-08-30 alongside the model IDs above. A model
 * missing here produces a null estimate rather than a wrong one — telemetry
 * must never invent a price, for the same reason MARKA's copy never does.
 */
const PRICING_PER_MILLION_USD: Record<string, { input: number; output: number }> = {
  'gpt-5.6-sol': { input: 4, output: 20 },
  'gpt-5.6-terra': { input: 2, output: 12 },
  'gpt-5.6-luna': { input: 0.2, output: 1.2 },
}

/** Rough request cost in USD, or null when the model's price is not pinned. */
export function estimateCostUsd(
  model: string,
  usage: { inputTokens: number; outputTokens: number } | null,
): number | null {
  if (!usage) return null
  const price = PRICING_PER_MILLION_USD[model]
  if (!price) return null
  const usd =
    (usage.inputTokens / 1_000_000) * price.input +
    (usage.outputTokens / 1_000_000) * price.output
  return Number(usd.toFixed(6))
}
