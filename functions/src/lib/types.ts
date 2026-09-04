/**
 * Wire types shared with the frontend.
 *
 * These mirror `src/types` in the web app. They are duplicated rather than
 * imported because Functions builds as a separate CommonJS package; if they
 * drift, chat breaks, so change them together.
 */

export type MessageRole = 'user' | 'assistant' | 'system'

export interface TextBlock {
  id: string
  type: 'text'
  text: string
}

export interface ErrorBlock {
  id: string
  type: 'error'
  message: string
  code: string | null
}

/**
 * A marketing recommendation in the thread. Carries a *reference* to the
 * persisted recommendation plus only what the card renders — the full object
 * lives once, in the `recommendations` collection.
 */
export interface MarketingRecommendationBlock {
  id: string
  type: 'marketing_recommendation'
  recommendationId: string
  /** The recommended opportunity's title. */
  title: string
  goal: string
  diagnosis: string
  /** Concise decision-relevant rationale — never chain-of-thought. */
  why: string
  /** 'known' only when the Business Brain establishes the audience. */
  audience: { description: string; basis: 'known' | 'hypothesis' } | null
  /** 'existing' only for an offer the Business Brain records. */
  offer: { description: string; basis: 'existing' | 'recommendation' } | null
  confidence: 'high' | 'medium' | 'low'
  nextAction: 'build_campaign' | 'confirm_business_info' | 'clarify_goal'
}

/**
 * A campaign in the thread. Same pattern as the recommendation block: a
 * *reference* to the persisted campaign plus only what the card renders —
 * the full object lives once, in the `campaigns` collection.
 */
export interface CampaignCardBlock {
  id: string
  type: 'campaign_card'
  campaignId: string
  name: string
  status: 'draft' | 'ready' | 'archived'
  objective: string | null
  /** 'known' only when the Business Brain establishes the audience. */
  audience: { description: string; basis: 'known' | 'hypothesis' } | null
  /** 'existing' only for an offer the Business Brain records. */
  offer: { description: string; basis: 'existing' | 'recommendation' } | null
  keyMessage: string | null
  callToAction: string | null
  channels: ('facebook' | 'instagram' | 'whatsapp' | 'tiktok' | 'in_store' | 'website')[]
  durationDays: number | null
}

/**
 * A creative in the thread. Same pattern again: a *reference* to the persisted
 * creative plus only what the preview renders — the full structured object
 * lives once, in the `creatives` collection. The poster stays structured
 * (image + copy fields), never a flattened PNG.
 */
export interface CreativePreviewBlock {
  id: string
  type: 'creative_preview'
  creativeId: string
  campaignId: string
  name: string
  format: 'square_post' | 'portrait_post'
  headline: string | null
  subheadline: string | null
  callToAction: string | null
  offerText: string | null
  /** Null when the image failed or was skipped; the copy still stands. */
  image: {
    storagePath: string
    /** 'generated' imagery is never presented as a real product photo. */
    source: 'upload' | 'generated' | 'stock'
    altText: string | null
  } | null
  /** True when image generation failed — the UI offers a retry. */
  imageFailed: boolean
  captions: {
    facebook: string | null
    instagram: string | null
    short: string | null
    whatsapp: string | null
  }
}

/**
 * A file the user attached to their message. Immutable historical context:
 * everything the thread needs to render lives on the block, so the message
 * survives the referenced Asset being archived or the attachment ageing out.
 */
export interface AttachmentBlock {
  id: string
  type: 'attachment'
  attachmentId: string
  fileName: string
  contentType: string
  sizeBytes: number
  storagePath: string
  /** Set when the attachment references (or was saved as) a permanent Asset. */
  assetId: string | null
}

export type MessageBlock =
  | TextBlock
  | ErrorBlock
  | MarketingRecommendationBlock
  | CampaignCardBlock
  | CreativePreviewBlock
  | AttachmentBlock

export interface StoredMessage {
  ownerId: string
  conversationId: string
  role: MessageRole
  blocks: MessageBlock[]
  plainText: string
  status: 'pending' | 'complete' | 'failed'
  meta: MessageMeta | null
  createdAt: number
  updatedAt: number
}

export interface MessageMeta {
  model: string | null
  task: string | null
  latencyMs: number | null
  usage: { inputTokens: number; outputTokens: number } | null
}

export interface AssistantReplyRequest {
  conversationId: string
  businessId: string | null
  userMessageId: string
}

export interface AssistantReplyResponse {
  conversationId: string
  assistantMessageId: string
}

export interface BuildCampaignRequest {
  recommendationId: string
}

export interface BuildCampaignResponse {
  campaignId: string
  /** Where the confirmation message was written, when the thread still exists. */
  conversationId: string | null
}

export interface GenerateCreativeRequest {
  campaignId: string
  /** Poster shape. Defaults to square when absent. */
  format?: 'square_post' | 'portrait_post'
}

export interface GenerateCreativeResponse {
  creativeId: string
  /** Where the presentation message was written, when the thread still exists. */
  conversationId: string | null
  /** False when the poster image could not be generated; the copy still exists. */
  imageReady: boolean
}

export interface RetryCreativeImageRequest {
  creativeId: string
}

export interface RetryCreativeImageResponse {
  creativeId: string
  conversationId: string | null
  imageReady: boolean
}

/**
 * "Save to Assets" for one chat attachment. Only ids cross the wire — the
 * backend re-reads the attachment, verifies ownership, and does the copy
 * itself, so a tampered client cannot name someone else's file.
 */
export interface SaveAttachmentToAssetsRequest {
  conversationId: string
  attachmentId: string
}

export interface SaveAttachmentToAssetsResponse {
  assetId: string
}

/**
 * Poster download fallback. When the browser cannot read the poster image
 * cross-origin (Storage media responses carry no CORS headers until the
 * bucket is configured), the client asks the backend for the bytes instead.
 * Only the creative id crosses the wire — the backend re-reads the creative,
 * verifies ownership, and serves only objects under that business's own
 * storage prefix.
 */
export interface DownloadCreativeImageRequest {
  creativeId: string
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
