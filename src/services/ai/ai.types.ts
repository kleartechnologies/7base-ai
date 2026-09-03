import type { EntityId } from '@/types'

/**
 * The contract between the browser and the MARKA AI backend.
 *
 * This file is intentionally free of any OpenAI concept. The frontend knows
 * about *MARKA tasks* and *structured results*; which model answers them, with
 * which prompt, is entirely a backend concern.
 */

/**
 * The units of work MARKA can be asked to do.
 *
 * Only `chat.reply` is implemented in the foundation phase. The rest are
 * declared so routing, permissions and telemetry are designed around the full
 * set from the start rather than retrofitted.
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

export interface AssistantReplyRequest {
  conversationId: EntityId
  businessId: EntityId | null
  /** The message being replied to; lets the backend ignore stale retries. */
  userMessageId: EntityId
}

export interface AssistantReplyResponse {
  conversationId: EntityId
  assistantMessageId: EntityId
}

/**
 * Website analysis is two calls, not one.
 *
 * `start` returns as soon as the business exists and is marked as analysing,
 * so the UI can subscribe to real progress. `run` does the slow work and
 * writes each stage to the business document as it reaches it. Splitting them
 * is what lets the loading screen report actual stages instead of a fake
 * progress bar.
 */
export interface StartWebsiteAnalysisRequest {
  websiteUrl: string
}

export interface StartWebsiteAnalysisResponse {
  businessId: EntityId
  /** The normalised URL the backend will actually fetch. */
  websiteUrl: string
  /** True when an existing business for this site is being refreshed. */
  reanalysis: boolean
}

export interface RunWebsiteAnalysisRequest {
  businessId: EntityId
}

export interface RunWebsiteAnalysisResponse {
  businessId: EntityId
  pagesAnalysed: number
  summary: string
}

/**
 * Callable results are normalised to this envelope rather than thrown.
 *
 * A failed AI call is an expected outcome — the model is slow, the key is not
 * configured, a quota is hit — and the chat UI needs to render it in the
 * thread, not crash a boundary.
 */
export type AiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: AiError }

export interface AiError {
  code: AiErrorCode
  message: string
}

export type AiErrorCode =
  | 'unauthenticated'
  | 'permission_denied'
  | 'not_configured'
  | 'rate_limited'
  | 'timeout'
  | 'unavailable'
  | 'invalid_request'
  | 'unknown'

export interface BuildCampaignRequest {
  recommendationId: EntityId
}

export interface BuildCampaignResponse {
  campaignId: EntityId
  /** Where the confirmation message was written, when the thread still exists. */
  conversationId: EntityId | null
}

export interface GenerateCreativeRequest {
  campaignId: EntityId
  /** Poster shape. Defaults to square when absent. */
  format?: 'square_post' | 'portrait_post'
}

export interface GenerateCreativeResponse {
  creativeId: EntityId
  /** Where the presentation message was written, when the thread still exists. */
  conversationId: EntityId | null
  /** False when the poster image could not be generated; the copy still exists. */
  imageReady: boolean
}

export interface RetryCreativeImageRequest {
  creativeId: EntityId
}

export interface RetryCreativeImageResponse {
  creativeId: EntityId
  conversationId: EntityId | null
  imageReady: boolean
}
