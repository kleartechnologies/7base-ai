import type { DnaSourceSummary, EntityId } from '@/types'

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
 * One chunk of a streamed assistant reply — the next piece of EVA's text, in
 * order. Only conversational replies stream; structured replies
 * (recommendations, campaign and creative edits) arrive whole, so a stream
 * with zero chunks followed by the final response is normal. Mirrors
 * functions/src/lib/types.ts.
 */
export interface AssistantReplyStreamChunk {
  type: 'delta'
  text: string
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
 * Business DNA (Phase 7E). The server resolves the business's own sources;
 * `links` may add or replace at most three page links (a website, a
 * Facebook Page, an Instagram profile). Nothing about the brand — colours,
 * fonts, logo — is ever sent from the client.
 */
export interface AnalyseBusinessDnaRequest {
  businessId: EntityId
  links?: string[]
}

export interface AnalyseBusinessDnaResponse {
  businessId: EntityId
  sources: DnaSourceSummary[]
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

/**
 * "Save to Assets" for one chat attachment. Only ids cross the wire — the
 * backend re-reads the attachment, verifies ownership, and does the copy
 * itself, so a tampered client cannot name someone else's file.
 */
export interface SaveAttachmentToAssetsRequest {
  conversationId: EntityId
  attachmentId: EntityId
}

export interface SaveAttachmentToAssetsResponse {
  assetId: EntityId
}

/**
 * Poster download fallback. When the browser cannot read the poster image
 * cross-origin (the Storage bucket's media responses carry no CORS headers
 * until the bucket is configured), the client asks the backend for the bytes
 * instead. Only the creative id crosses the wire — the backend re-reads the
 * creative and verifies ownership itself.
 */
export interface DownloadCreativeImageRequest {
  creativeId: EntityId
}

export interface CreativeImagePayload {
  contentType: string
  base64: string
}

export interface DownloadCreativeImageResponse {
  /** Null when the creative has no image (text-only poster). */
  image: CreativeImagePayload | null
  /** Null when no logo is snapshotted or the logo could not be read. */
  logo: CreativeImagePayload | null
}
