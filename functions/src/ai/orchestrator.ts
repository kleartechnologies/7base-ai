import { logger } from 'firebase-functions'
import {
  estimateCostUsd,
  resolveModelForTask,
  type AiTask,
  type ModelConfig,
} from '../config/models'
import type { MessageBlock, MessageMeta } from '../lib/types'
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
  systemPrompt: string
  /** Prior turns, oldest first. */
  history: OrchestrationTurn[]
}

export interface OrchestrationTurn {
  role: 'user' | 'assistant'
  text: string
}

export interface OrchestrationResult {
  blocks: MessageBlock[]
  plainText: string
  meta: MessageMeta
}

export interface StructuredRequest {
  task: AiTask
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
  config: ModelConfig
  latencyMs: number
  promptChars: number
  response: ProviderResponse
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

function recordTiming({ task, config, latencyMs, promptChars, response }: TimingRecord): void {
  const usage = response.usage
  const inputTokens = usage?.input_tokens ?? 0
  const outputTokens = usage?.output_tokens ?? 0
  const reasoningTokens = usage?.output_tokens_details?.reasoning_tokens ?? 0

  logger.info('ai.request.complete', {
    task,
    model: config.model,
    status: response.status ?? 'completed',
    latencyMs,
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
    estimatedCostUsd: estimateCostUsd(config.model, { inputTokens, outputTokens }),
  })
}

/** Logs a provider failure by code, never by message, and returns it classified. */
function reportFailure(
  task: AiTask,
  config: ModelConfig,
  latencyMs: number,
  error: unknown,
): AiServiceError {
  const classified = classifyProviderError(error)
  logger.warn('ai.request.failed', {
    task,
    model: config.model,
    latencyMs,
    ...classified.diagnostics,
  })
  return classified
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

  const config = resolveModelForTask(request.task)
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
    throw reportFailure(request.task, config, Date.now() - startedAt, error)
  }

  const latencyMs = Date.now() - startedAt
  recordTiming({
    task: request.task,
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

  const config = resolveModelForTask(request.task)
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
    throw reportFailure(request.task, config, Date.now() - startedAt, error)
  }

  const latencyMs = Date.now() - startedAt
  recordTiming({
    task: request.task,
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

  const config = resolveModelForTask(request.task)
  const startedAt = Date.now()

  let response
  try {
    response = await getOpenAI().responses.create({
      model: config.model,
      instructions: request.systemPrompt,
      input: request.history.map((turn) => ({
        role: turn.role,
        content: turn.text,
      })),
      max_output_tokens: config.maxOutputTokens,
      ...(config.temperature === null ? {} : { temperature: config.temperature }),
    }, { timeout: config.timeoutMs, maxRetries: config.maxRetries })
  } catch (error) {
    throw reportFailure(request.task, config, Date.now() - startedAt, error)
  }

  const text = response.output_text?.trim() ?? ''
  const latencyMs = Date.now() - startedAt
  recordTiming({
    task: request.task,
    config,
    latencyMs,
    promptChars:
      request.systemPrompt.length +
      request.history.reduce((total, turn) => total + turn.text.length, 0),
    response,
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
