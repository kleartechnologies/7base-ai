import { logger } from 'firebase-functions'
import { HttpsError } from 'firebase-functions/v2/https'
import {
  estimateCostUsd,
  resolveModelForTask,
  type AiTask,
  type ModelConfig,
  type SubscriptionPlan,
} from '../config/models'
import type { MessageBlock, MessageMeta } from '../lib/types'
import { reserveAiUsage, settleAiUsage, settleAiUsageFailure } from '../usage/guardrail'
import {
  buildUsageReservation,
  CONTEXT_TOO_LARGE_MESSAGE,
  MAX_REQUEST_CHARS,
  ZERO_ACTUAL,
} from '../usage/limits'
import { classifyProviderError, type AiServiceError } from './errors'
import { getOpenAI, isConfigured } from './openai.client'

/**
 * The MARKA AI orchestration layer.
 *
 * Everything above it (callables, triggers) asks for a *task* and receives
 * *structured blocks*. Everything below it (models, prompts, the OpenAI SDK)
 * is private. That boundary is what lets model routing, retries, caching and
 * eventually multi-step planning change without touching a single caller.
 *
 * Built on the Responses API rather than Chat Completions: it is the surface
 * that carries structured outputs, hosted tools and reasoning state, all of
 * which MARKA needs for campaign generation.
 */

export interface OrchestrationRequest {
  task: AiTask
  /**
   * The authenticated caller, from the callable's verified auth context —
   * never from a client payload. Required on every request because the Phase
   * 6B usage guardrail runs inside this module: an OpenAI call with no owner
   * would be an OpenAI call with no budget.
   */
  uid: string
  /**
   * The caller's subscription plan, resolved server-side by the callable
   * boundary (lib/auth.ts `resolvePlanForUser`) — never taken from a client
   * payload. Required on every request so a new task cannot silently forget
   * to route by plan.
   */
  plan: SubscriptionPlan
  systemPrompt: string
  /** Prior turns, oldest first. */
  history: OrchestrationTurn[]
  /**
   * When present, the provider call streams and each text delta is forwarded
   * here the moment it arrives — before the full reply exists. Everything
   * else is identical to the buffered path: same reservation before the call,
   * same settlement from the provider's final usage report, same single
   * request counted. The callback must not throw; anything it raises is
   * swallowed so a broken consumer (say, a disconnected client) can never
   * corrupt usage accounting for a reply that is still being billed.
   */
  onDelta?: (delta: string) => void
}

export interface OrchestrationTurn {
  role: 'user' | 'assistant'
  text: string
  /**
   * Multimodal parts for this turn, already resolved to safe payloads by the
   * caller (bytes fetched server-side from owned Storage objects, encoded as
   * data URLs — never a client-supplied URL). Only the latest user turn ever
   * carries parts; turns without them are sent exactly as before.
   */
  parts?: TurnAttachmentPart[]
}

/** One non-text input part, shaped for the Responses API. */
export type TurnAttachmentPart =
  | { type: 'input_image'; imageUrl: string }
  | { type: 'input_file'; filename: string; fileData: string }

export interface OrchestrationResult {
  blocks: MessageBlock[]
  plainText: string
  meta: MessageMeta
}

export interface StructuredRequest {
  task: AiTask
  /** The authenticated caller; see OrchestrationRequest. */
  uid: string
  /** Server-resolved subscription plan; see OrchestrationRequest. */
  plan: SubscriptionPlan
  systemPrompt: string
  /** The evidence the model reasons over. Never mixed into the instructions. */
  input: string
  schema: { name: string; schema: Record<string, unknown> }
}

export interface StructuredResult<T> {
  data: T
  meta: MessageMeta
}

export class AiNotConfiguredError extends Error {
  constructor() {
    super('OPENAI_API_KEY is not configured.')
    this.name = 'AiNotConfiguredError'
  }
}

export class AiResponseError extends Error {
  constructor(readonly reason: 'incomplete' | 'empty' | 'unparseable' | 'refused') {
    super(`Model did not return usable structured output: ${reason}`)
    this.name = 'AiResponseError'
  }
}

/* --- telemetry ---------------------------------------------------------- */

/**
 * What one model call actually cost, in time and tokens.
 *
 * MARKA's website analysis takes over a minute, and until this existed the
 * only thing the logs said about that minute was its total. That is not enough
 * to act on: a slow call caused by a 24k-character corpus and a slow call
 * caused by thousands of reasoning tokens want opposite fixes, and guessing
 * between them is how an architecture gets rewritten for no reason.
 *
 * Everything here is a count or a duration. No prompt text, no completion
 * text, no business data, no key material — this is safe to leave on in
 * production, which is the point of measuring it rather than reproducing it.
 */
interface TimingRecord {
  task: AiTask
  /** Which plan paid for this call — the axis the Basic/Pro cost comparison groups by. */
  plan: SubscriptionPlan
  config: ModelConfig
  latencyMs: number
  promptChars: number
  response: ProviderResponse
  /**
   * Streamed calls only: how long the user waited before the first visible
   * text. This is the number streaming exists to improve — total latency can
   * stay identical while the product feels twice as fast. Null for buffered
   * calls, where "first token" and "whole answer" are the same moment.
   */
  timeToFirstTokenMs?: number | null
}

/** The slice of the Responses API result telemetry reads. */
interface ProviderResponse {
  status?: string | null
  usage?: {
    input_tokens?: number
    output_tokens?: number
    input_tokens_details?: { cached_tokens?: number }
    output_tokens_details?: { reasoning_tokens?: number }
  } | null
}

function recordTiming({
  task,
  plan,
  config,
  latencyMs,
  promptChars,
  response,
  timeToFirstTokenMs,
}: TimingRecord): void {
  const usage = response.usage
  const inputTokens = usage?.input_tokens ?? 0
  const outputTokens = usage?.output_tokens ?? 0
  const reasoningTokens = usage?.output_tokens_details?.reasoning_tokens ?? 0

  logger.info('ai.request.complete', {
    task,
    plan,
    model: config.model,
    status: response.status ?? 'completed',
    latencyMs,
    timeToFirstTokenMs: timeToFirstTokenMs ?? null,
    promptChars,
    inputTokens,
    outputTokens,
    reasoningTokens,
    /** Output tokens that were the answer rather than the thinking. */
    answerTokens: Math.max(outputTokens - reasoningTokens, 0),
    cachedInputTokens: usage?.input_tokens_details?.cached_tokens ?? 0,
    maxOutputTokens: config.maxOutputTokens,
    /** How close the answer came to the ceiling that would truncate it. */
    outputUtilisation: config.maxOutputTokens
      ? Number((outputTokens / config.maxOutputTokens).toFixed(3))
      : null,
    /** Rough throughput, the number that tells you whether output size is the story. */
    outputTokensPerSecond: latencyMs > 0 ? Math.round((outputTokens / latencyMs) * 1000) : null,
    /** Null when this model's price is not pinned — never a guess. */
    estimatedCostUsd: estimateCostUsd(config.model, {
      inputTokens,
      outputTokens,
      cachedInputTokens: usage?.input_tokens_details?.cached_tokens ?? 0,
    }),
  })
}

/** Logs a provider failure by code, never by message, and returns it classified. */
function reportFailure(
  task: AiTask,
  plan: SubscriptionPlan,
  config: ModelConfig,
  latencyMs: number,
  error: unknown,
): AiServiceError {
  const classified = classifyProviderError(error)
  logger.warn('ai.request.failed', {
    task,
    plan,
    model: config.model,
    latencyMs,
    ...classified.diagnostics,
  })
  return classified
}

/* --- Phase 6B usage guardrail -------------------------------------------- */

/**
 * The context-size gate, BEFORE any reservation or model call. Ceilings live
 * in usage/limits.ts and are sized well above anything the product builds,
 * so tripping one means the payload was forged or a caller is broken —
 * `invalid-argument`, not `resource-exhausted`, because no quota was spent.
 */
function assertContextWithinLimit(args: {
  task: AiTask
  uid: string
  plan: SubscriptionPlan
  promptChars: number
}): void {
  const maxChars = MAX_REQUEST_CHARS[args.task]
  if (args.promptChars > maxChars) {
    logger.warn('usage.blocked', {
      uid: args.uid,
      plan: args.plan,
      task: args.task,
      reason: 'context_limit',
      promptChars: args.promptChars,
      maxChars,
    })
    throw new HttpsError('invalid-argument', CONTEXT_TOO_LARGE_MESSAGE)
  }
}

/** Settlement facts for a finished text call, from the provider's own usage report. */
function textActual(model: string, response: ProviderResponse) {
  const usage = response.usage
  const inputTokens = usage?.input_tokens ?? 0
  const outputTokens = usage?.output_tokens ?? 0
  const cachedInputTokens = usage?.input_tokens_details?.cached_tokens ?? 0
  return {
    ...ZERO_ACTUAL,
    inputTokens,
    outputTokens,
    cachedInputTokens,
    costUsd: estimateCostUsd(model, { inputTokens, outputTokens, cachedInputTokens }) ?? 0,
  }
}

/**
 * Runs a task whose answer is data rather than prose.
 *
 * The schema is enforced by the Responses API in strict mode, so the model
 * cannot return a shape the caller did not ask for. The caller still validates
 * what comes back — schema-constrained generation guarantees the *shape*, not
 * that the contents are sane.
 */
export async function runStructuredTask<T>(
  request: StructuredRequest,
): Promise<StructuredResult<T>> {
  if (!isConfigured()) {
    throw new AiNotConfiguredError()
  }

  const config = resolveModelForTask(request.task, request.plan)
  const promptChars = request.systemPrompt.length + request.input.length
  assertContextWithinLimit({ task: request.task, uid: request.uid, plan: request.plan, promptChars })

  // Enforcement BEFORE OpenAI: worst case reserved, or resource-exhausted.
  const handle = await reserveAiUsage({
    uid: request.uid,
    plan: request.plan,
    task: request.task,
    reservation: buildUsageReservation({
      task: request.task,
      model: config.model,
      maxOutputTokens: config.maxOutputTokens,
      promptChars,
    }),
  })

  const startedAt = Date.now()
  let response
  try {
    response = await getOpenAI().responses.create({
      model: config.model,
      instructions: request.systemPrompt,
      input: [{ role: 'user', content: request.input }],
      max_output_tokens: config.maxOutputTokens,
      ...(config.temperature === null ? {} : { temperature: config.temperature }),
      text: {
        format: {
          type: 'json_schema',
          name: request.schema.name,
          schema: request.schema.schema,
          strict: true,
        },
      },
    }, { timeout: config.timeoutMs, maxRetries: config.maxRetries })
  } catch (error) {
    // Zero tokens billed as far as we can know, but the attempt stays
    // counted — a failing loop exhausts requests, not the token budget.
    await settleAiUsageFailure(handle)
    throw reportFailure(request.task, request.plan, config, Date.now() - startedAt, error)
  }

  // Measurement AFTER OpenAI: the response is billed whether or not it
  // parses, so settlement happens before any validation can throw.
  await settleAiUsage(handle, textActual(config.model, response))

  const latencyMs = Date.now() - startedAt
  recordTiming({
    task: request.task,
    plan: request.plan,
    config,
    latencyMs,
    promptChars: request.systemPrompt.length + request.input.length,
    response,
  })

  // A truncated response is still valid JSON-shaped text sometimes; treating
  // it as success would store half a Business Brain.
  if (response.status === 'incomplete') {
    logger.warn('Structured response truncated', {
      task: request.task,
      model: config.model,
      reason: response.incomplete_details?.reason,
    })
    throw new AiResponseError('incomplete')
  }

  const text = response.output_text?.trim() ?? ''
  if (!text) throw new AiResponseError('empty')

  let data: T
  try {
    data = JSON.parse(text) as T
  } catch {
    throw new AiResponseError('unparseable')
  }

  return {
    data,
    meta: {
      model: config.model,
      task: request.task,
      latencyMs,
      usage: response.usage
        ? {
            inputTokens: response.usage.input_tokens ?? 0,
            outputTokens: response.usage.output_tokens ?? 0,
          }
        : null,
    },
  }
}

export interface ImageRequest {
  task: AiTask
  /** The authenticated caller; see OrchestrationRequest. */
  uid: string
  /**
   * Server-resolved subscription plan; see OrchestrationRequest. Both plans
   * share one image model today — carried anyway so the telemetry can split
   * image cost by plan.
   */
  plan: SubscriptionPlan
  /** Built from structured Creative/Campaign data — never raw user text. */
  prompt: string
  size: '1024x1024' | '1024x1536'
}

export interface ImageResult {
  /** PNG bytes. The caller persists them; they never cross to the client raw. */
  imageBytes: Buffer
  meta: MessageMeta
}

/**
 * Runs a task whose answer is an image.
 *
 * The Images API is a different surface from Responses, but it goes through
 * the same tier configuration, the same failure classification and the same
 * telemetry event as every other model call — an image request must never be
 * the one OpenAI call the logs cannot account for.
 */
export async function runImageTask(request: ImageRequest): Promise<ImageResult> {
  if (!isConfigured()) {
    throw new AiNotConfiguredError()
  }

  const config = resolveModelForTask(request.task, request.plan)
  assertContextWithinLimit({
    task: request.task,
    uid: request.uid,
    plan: request.plan,
    promptChars: request.prompt.length,
  })

  // One image attempt = one unit of image quota, reserved BEFORE the model
  // runs. A failed attempt stays consumed — the spend happened.
  const handle = await reserveAiUsage({
    uid: request.uid,
    plan: request.plan,
    task: request.task,
    reservation: buildUsageReservation({
      task: request.task,
      model: config.model,
      maxOutputTokens: config.maxOutputTokens,
      promptChars: request.prompt.length,
    }),
  })

  const startedAt = Date.now()
  let response
  try {
    response = await getOpenAI().images.generate(
      {
        model: config.model,
        prompt: request.prompt,
        size: request.size,
        // One image, medium quality: posters for small businesses, not print
        // runs. Quality is the image tier's main cost knob.
        n: 1,
        quality: 'medium',
      },
      { timeout: config.timeoutMs, maxRetries: config.maxRetries },
    )
  } catch (error) {
    await settleAiUsageFailure(handle)
    throw reportFailure(request.task, request.plan, config, Date.now() - startedAt, error)
  }

  // Image tokens are booked to their own counters, never the text budget.
  {
    const inputTokens = response.usage?.input_tokens ?? 0
    const outputTokens = response.usage?.output_tokens ?? 0
    await settleAiUsage(handle, {
      ...ZERO_ACTUAL,
      imageInputTokens: inputTokens,
      imageOutputTokens: outputTokens,
      costUsd: estimateCostUsd(config.model, { inputTokens, outputTokens }) ?? 0,
      imageGenerated: Boolean(response.data?.[0]?.b64_json),
    })
  }

  const latencyMs = Date.now() - startedAt
  recordTiming({
    task: request.task,
    plan: request.plan,
    config,
    latencyMs,
    promptChars: request.prompt.length,
    response: {
      status: 'completed',
      // The Images API usage shape differs from Responses in its details
      // objects; the counts are what telemetry reads, so map just those.
      usage: response.usage
        ? {
            input_tokens: response.usage.input_tokens,
            output_tokens: response.usage.output_tokens,
          }
        : null,
    },
  })

  const b64 = response.data?.[0]?.b64_json
  if (!b64) throw new AiResponseError('empty')

  return {
    imageBytes: Buffer.from(b64, 'base64'),
    meta: {
      model: config.model,
      task: request.task,
      latencyMs,
      usage: response.usage
        ? {
            inputTokens: response.usage.input_tokens ?? 0,
            outputTokens: response.usage.output_tokens ?? 0,
          }
        : null,
    },
  }
}

/**
 * Runs one task and returns MARKA-shaped output.
 *
 * Today every task produces a single text block. Structured tasks (campaign
 * generation, creative briefs) will request a JSON schema from the Responses
 * API and map the parsed result to richer block types — the return contract
 * here does not change when they do.
 */
export async function runTask(request: OrchestrationRequest): Promise<OrchestrationResult> {
  if (!isConfigured()) {
    throw new AiNotConfiguredError()
  }

  const config = resolveModelForTask(request.task, request.plan)
  const promptChars =
    request.systemPrompt.length +
    request.history.reduce((total, turn) => total + turn.text.length, 0)
  assertContextWithinLimit({ task: request.task, uid: request.uid, plan: request.plan, promptChars })

  // Attachment parts carry token weight the char count cannot see, so the
  // reservation books a flat conservative figure per part; settlement then
  // replaces the estimate with what the provider actually billed.
  const parts = request.history.flatMap((turn) => turn.parts ?? [])
  const handle = await reserveAiUsage({
    uid: request.uid,
    plan: request.plan,
    task: request.task,
    reservation: buildUsageReservation({
      task: request.task,
      model: config.model,
      maxOutputTokens: config.maxOutputTokens,
      promptChars,
      imageParts: parts.filter((part) => part.type === 'input_image').length,
      fileParts: parts.filter((part) => part.type === 'input_file').length,
    }),
  })

  const params = {
    model: config.model,
    instructions: request.systemPrompt,
    // A turn without parts keeps the plain-string content it always had —
    // text-only conversations produce a byte-identical request.
    input: request.history.map((turn) =>
      turn.parts && turn.parts.length > 0
        ? {
            role: turn.role,
            content: [
              { type: 'input_text' as const, text: turn.text },
              ...turn.parts.map((part) =>
                part.type === 'input_image'
                  ? { type: 'input_image' as const, detail: 'auto' as const, image_url: part.imageUrl }
                  : { type: 'input_file' as const, filename: part.filename, file_data: part.fileData },
              ),
            ],
          }
        : { role: turn.role, content: turn.text },
    ),
    max_output_tokens: config.maxOutputTokens,
    ...(config.temperature === null ? {} : { temperature: config.temperature }),
  }
  const requestOptions = { timeout: config.timeoutMs, maxRetries: config.maxRetries }

  const startedAt = Date.now()
  let firstTokenAt: number | null = null
  let streamedText = ''
  let response: ProviderResponse & { output_text?: string | null }
  try {
    if (request.onDelta) {
      // The streamed and buffered calls are the same request to the same
      // model with the same limits — only the delivery differs. The terminal
      // event carries the same status and usage the buffered path reads, so
      // settlement and telemetry below are shared, not duplicated.
      const stream = await getOpenAI().responses.create(
        { ...params, stream: true as const },
        requestOptions,
      )
      let terminal: (ProviderResponse & { output_text?: string | null }) | null = null
      for await (const event of stream) {
        if (event.type === 'response.output_text.delta') {
          if (firstTokenAt === null) firstTokenAt = Date.now()
          streamedText += event.delta
          try {
            request.onDelta(event.delta)
          } catch {
            // A broken consumer (say, a client that disconnected mid-reply)
            // must not abort a generation that is being billed regardless —
            // the finished reply is still persisted and settled.
          }
        } else if (
          event.type === 'response.completed' ||
          event.type === 'response.incomplete' ||
          event.type === 'response.failed'
        ) {
          terminal = event.response
        }
      }
      if (!terminal) {
        // The connection dropped before the provider said how it ended.
        throw new Error('The response stream ended without completing.')
      }
      if (terminal.status === 'failed') {
        // Streamed failures arrive as an event, not a thrown error. Rethrow
        // with the provider's code so classification (and the owner-safe
        // sentence it picks) works exactly as on the buffered path.
        throw Object.assign(new Error('The response stream reported failure.'), {
          code: (terminal as { error?: { code?: string | null } }).error?.code ?? null,
        })
      }
      response = terminal
    } else {
      response = await getOpenAI().responses.create(params, requestOptions)
    }
  } catch (error) {
    await settleAiUsageFailure(handle)
    throw reportFailure(request.task, request.plan, config, Date.now() - startedAt, error)
  }

  await settleAiUsage(handle, textActual(config.model, response))

  // The deltas are the source of truth for a streamed reply: the terminal
  // event's raw JSON does not carry the SDK's aggregated `output_text`.
  const text = (request.onDelta ? streamedText : response.output_text ?? '').trim()
  const latencyMs = Date.now() - startedAt
  recordTiming({
    task: request.task,
    plan: request.plan,
    config,
    latencyMs,
    promptChars,
    response,
    timeToFirstTokenMs: firstTokenAt === null ? null : firstTokenAt - startedAt,
  })

  if (!text) {
    logger.warn('Model returned no text', { task: request.task, model: config.model })
  }

  return {
    blocks: [{ id: 'b0', type: 'text', text: text || 'Sorry — I could not put together a reply. Please try again.' }],
    plainText: text,
    meta: {
      model: config.model,
      task: request.task,
      latencyMs,
      usage: response.usage
        ? {
            inputTokens: response.usage.input_tokens ?? 0,
            outputTokens: response.usage.output_tokens ?? 0,
          }
        : null,
    },
  }
}
