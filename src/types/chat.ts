import type { EntityId, Millis, OwnedEntity } from './common'

export interface Conversation extends OwnedEntity {
  businessId: EntityId | null
  /** Derived from the first user message; editable later. */
  title: string
  lastMessagePreview: string | null
  messageCount: number
}

export type MessageRole = 'user' | 'assistant' | 'system'

export interface Message extends OwnedEntity {
  conversationId: EntityId
  role: MessageRole
  /**
   * Structured content. Plain prose is just a single `text` block, which keeps
   * one rendering path for everything MARKA can say — no special-casing when
   * campaign cards and creative previews arrive.
   */
  blocks: MessageBlock[]
  /** Flattened text used for previews, titles and search. */
  plainText: string
  status: MessageStatus
  /** Present on assistant messages once generation finishes. */
  meta: MessageMeta | null
}

export type MessageStatus = 'pending' | 'complete' | 'failed'

export interface MessageMeta {
  model: string | null
  /** Which orchestration task produced this message. */
  task: string | null
  latencyMs: number | null
  /** Never shown to the user; for cost and quality review. */
  usage: TokenUsage | null
}

export interface TokenUsage {
  inputTokens: number
  outputTokens: number
}

/**
 * The block union.
 *
 * `text`, `error` and `marketing_recommendation` are rendered today. The
 * remaining variants are declared so the chat transport, storage schema and
 * renderer contract are already correct when those features land — adding one
 * means writing a renderer, not reworking chat.
 */
export type MessageBlock =
  | TextBlock
  | ErrorBlock
  | MarketingRecommendationBlock
  | RecommendationBlock
  | ActionBlock
  | CampaignCardBlock
  | CreativePreviewBlock
  | AttachmentBlock
  | ActionProposalBlock
  | CreativeSetBlock

export interface BlockBase {
  id: string
  type: string
}

export interface TextBlock extends BlockBase {
  type: 'text'
  /** Markdown-ish plain text. */
  text: string
}

export interface ErrorBlock extends BlockBase {
  type: 'error'
  message: string
  /** Machine-readable reason, for the UI to offer the right recovery. */
  code: string | null
}

/**
 * A marketing recommendation in the thread. Mirrors the Functions wire type:
 * a *reference* to the persisted recommendation plus only what the card
 * renders — the full object lives once, in `recommendations`.
 */
export interface MarketingRecommendationBlock extends BlockBase {
  type: 'marketing_recommendation'
  recommendationId: EntityId
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

export interface RecommendationBlock extends BlockBase {
  type: 'recommendation'
  title: string
  rationale: string
  /** Ordered, most impactful first. */
  steps: string[]
}

export interface ActionBlock extends BlockBase {
  type: 'action'
  label: string
  /** Namespaced intent, e.g. 'campaign.create'. Resolved by the UI. */
  intent: string
  payload: Record<string, unknown> | null
}

/**
 * A campaign in the thread. Mirrors the Functions wire type: a *reference*
 * to the persisted campaign plus only what the card renders — the full
 * object lives once, in `campaigns`.
 */
export interface CampaignCardBlock extends BlockBase {
  type: 'campaign_card'
  campaignId: EntityId
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
 * A creative in the thread. Mirrors the Functions wire type: a *reference*
 * to the persisted creative plus only what the preview renders — the full
 * structured object lives once, in `creatives`.
 */
export interface CreativePreviewBlock extends BlockBase {
  type: 'creative_preview'
  creativeId: EntityId
  campaignId: EntityId
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
 * A file attached to one chat message. Distinct from an Asset on purpose: an
 * attachment is conversational context, scoped to its thread; an Asset is a
 * permanent business material. "Save to Assets" promotes a copy — it never
 * turns one into the other.
 *
 * The document lives at `conversations/{conversationId}/attachments/{id}`;
 * for `source: 'upload'` the file lives under the conversation's own Storage
 * folder, for `source: 'asset'` the attachment references the existing
 * Asset's file without duplicating it.
 */
export interface ChatAttachment {
  id: EntityId
  ownerId: EntityId
  businessId: EntityId
  conversationId: EntityId
  /** The message this attachment belongs to, fixed before either is written. */
  messageId: EntityId
  fileName: string
  contentType: string
  sizeBytes: number
  storagePath: string
  source: AttachmentSource
  status: AttachmentStatus
  /**
   * For `source: 'asset'`, the Asset being referenced. For uploads, set by
   * the backend when the owner saves the attachment to Assets — the document
   * records the promotion; the message block never changes.
   */
  assetId: EntityId | null
  createdAt: Millis
}

/** How the attachment arrived: a fresh upload, or a reference to an Asset. */
export type AttachmentSource = 'upload' | 'asset'

export type AttachmentStatus = 'active' | 'deleted'

/**
 * An attachment in a message. Carries everything historical rendering needs
 * — including the immutable `storagePath`, like `CreativePreviewBlock` — so
 * the thread stays renderable even if a referenced Asset is later archived.
 */
export interface AttachmentBlock extends BlockBase {
  type: 'attachment'
  attachmentId: EntityId
  fileName: string
  contentType: string
  sizeBytes: number
  storagePath: string
  /** Set when the attachment referenced an existing Asset at send time. */
  assetId: EntityId | null
}

/** What the composer stages before send: a new file or an Asset reference. */
export type AttachmentDraft =
  | { kind: 'file'; file: File }
  | {
      kind: 'asset'
      asset: {
        id: EntityId
        fileName: string
        contentType: string
        sizeBytes: number
        storagePath: string
      }
    }

/** What the client sends when the user submits the composer. */
export interface SendMessageInput {
  conversationId: EntityId | null
  businessId: EntityId | null
  text: string
  /** At most `MAX_ATTACHMENTS_PER_MESSAGE`; validated again before upload. */
  attachments?: AttachmentDraft[]
}

export interface SendMessageResult {
  conversationId: EntityId
  userMessageId: EntityId
  assistantMessageId: EntityId
}

/** An unsaved assistant message shown while the backend is working. */
export interface PendingMessage {
  id: EntityId
  conversationId: EntityId
  role: 'assistant'
  createdAt: Millis
}

/* --- Phase 7F: EVA actions ------------------------------------------------- */

/**
 * What one request for materials asks for. Mirrors functions/src/lib/types.ts.
 * `positions` are the slots of the set this request covers — a retry after a
 * partial failure carries only the missing ones — and `size` is the whole
 * set, so "2 of the 3" stays honest.
 */
export interface CreativeRequestSpec {
  format: 'square_post' | 'portrait_post'
  /** The owner's words, or the plan they agreed to — carried into the copy. */
  brief: string | null
  positions: number[]
  size: number
}

/**
 * An action EVA offered and is waiting on. Written only by the backend, on
 * her own turn; the client never composes one. Saying yes sends an ordinary
 * chat message — the server decides what the proposal meant and re-checks
 * ownership of every id in it.
 */
export type ProposedAction =
  | { kind: 'creative.generate'; campaignId: EntityId; campaignName: string; spec: CreativeRequestSpec }
  | { kind: 'campaign.create'; goal: string; then: CreativeRequestSpec | null }
  | { kind: 'campaign.choose'; choices: { campaignId: EntityId; name: string }[]; then: CreativeRequestSpec }

export interface ActionProposalBlock extends BlockBase {
  type: 'action_proposal'
  action: ProposedAction
  /** The go-ahead button's label, in the reply's language. */
  confirmLabel: string
}

/** One poster of a set — the same render fields as a creative preview. */
export interface CreativeSetItem {
  creativeId: EntityId
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
  imageFailed: boolean
}

/** Several posters created in one go; the Creative page holds the full objects. */
export interface CreativeSetBlock extends BlockBase {
  type: 'creative_set'
  campaignId: EntityId
  campaignName: string
  /** How many were asked for — the card says "2 of 3" when fewer arrived. */
  requested: number
  items: CreativeSetItem[]
}

/** A step of an action in flight, streamed while EVA works. */
export interface ActionProgressStep {
  key: 'campaign' | 'campaign_create' | 'brand' | 'assets' | 'concepts' | 'poster'
  state: 'pending' | 'active' | 'done' | 'failed'
  /** For `poster`: which one of `total`. */
  index?: number
  total?: number
}
