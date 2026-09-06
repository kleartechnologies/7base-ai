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

/**
 * What one chat request for posters asks for, in structured form. Built by
 * the server from the owner's message (or from EVA's own offer) and carried
 * inside a proposal until it is executed — never re-parsed from a "yes".
 */
export interface CreativeRequestSpec {
  /** Poster shape. */
  format: 'square_post' | 'portrait_post'
  /**
   * The owner's own words for what the posters should be ("1. English —
   * intro, 2. BM — step by step…"). Passed verbatim to the copy call as set
   * context so each poster in a set can take its own concept; never parsed
   * into structure server-side.
   */
  brief: string | null
  /**
   * Which positions of the set to create (1-based) and the set's full size.
   * A fresh "3 posters" is positions [1, 2, 3] of 3; retrying one that
   * failed is positions [3] of 3 — so a retry never recreates the two that
   * already exist.
   */
  positions: number[]
  size: number
}

/**
 * Something EVA can do the moment the owner says yes. Every id here was
 * resolved server-side from the owner's own data; the client only renders
 * the proposal and can answer it with an ordinary chat message.
 */
export type ProposedAction =
  | {
      kind: 'creative.generate'
      campaignId: string
      campaignName: string
      spec: CreativeRequestSpec
    }
  | {
      kind: 'campaign.create'
      /** The goal the recommendation engine is given, in the owner's words. */
      goal: string
      /** Posters to create once the campaign exists; null for a campaign alone. */
      then: CreativeRequestSpec | null
    }
  | {
      kind: 'campaign.choose'
      choices: { campaignId: string; name: string }[]
      then: CreativeRequestSpec
    }

/**
 * A pending action in the thread (Phase 7F). EVA writes one whenever she
 * needs the owner's go-ahead — no campaign yet, two plausible campaigns, a
 * daily limit that caps the count, one poster of a set that failed — or
 * when her own conversational reply offered to create materials. It is
 * *pending* only while it sits on the assistant turn directly before the
 * owner's next message: an affirmation there executes it, anything else
 * lets it lapse. Older proposals are inert history.
 */
export interface ActionProposalBlock {
  id: string
  type: 'action_proposal'
  action: ProposedAction
  /** The confirm button's label, in the language of the surrounding reply. */
  confirmLabel: string
}

/** One poster of a set, as the compact result card renders it. */
export interface CreativeSetItem {
  creativeId: string
  /** 1-based position in the requested set. */
  position: number
  name: string
  format: 'square_post' | 'portrait_post'
  headline: string | null
  subheadline: string | null
  callToAction: string | null
  offerText: string | null
  image: {
    storagePath: string
    source: 'upload' | 'generated' | 'stock'
    altText: string | null
  } | null
  /** True when the image failed — the owner retries it from the Creative page or this card. */
  imageFailed: boolean
}

/**
 * Several creatives made from one request, presented together (Phase 7F):
 * "Done — I created 3 posters." with a thumbnail row. Each item references
 * its persisted creative; the Creative page stays the canonical view.
 */
export interface CreativeSetBlock {
  id: string
  type: 'creative_set'
  campaignId: string
  campaignName: string
  /** How many the owner asked for; items.length is how many exist. */
  requested: number
  items: CreativeSetItem[]
}

export type MessageBlock =
  | TextBlock
  | ErrorBlock
  | MarketingRecommendationBlock
  | CampaignCardBlock
  | CreativePreviewBlock
  | AttachmentBlock
  | ActionProposalBlock
  | CreativeSetBlock

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

/**
 * One step of an action EVA is carrying out (Phase 7F), sent as progress
 * over the reply stream. Keys, not sentences: the client translates them,
 * and nothing about models, tasks, cost or quota ever rides along.
 */
export interface ActionProgressStep {
  key: 'campaign' | 'campaign_create' | 'brand' | 'assets' | 'concepts' | 'poster'
  state: 'pending' | 'active' | 'done' | 'failed'
  /** For `poster`: which one of how many. */
  index?: number
  total?: number
}

/**
 * One chunk of a streamed assistant reply, sent over the callable's own
 * stream while the reply is being generated. The conversational path streams
 * text deltas; an action (Phase 7F) streams its progress steps instead.
 * Structured replies (recommendations, campaign and creative edits) arrive
 * whole, exactly as before. Mirrored in the frontend's ai.types.ts.
 */
export type AssistantReplyStreamChunk =
  | {
      type: 'delta'
      /** The next piece of the reply's text, in order. */
      text: string
    }
  | {
      type: 'progress'
      /** The whole step list, latest state — not a diff. */
      steps: ActionProgressStep[]
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
