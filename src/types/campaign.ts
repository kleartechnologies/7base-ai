import type { EntityId, Millis, OwnedEntity } from './common'

/**
 * A campaign is the actionable form of a marketing recommendation — its own
 * domain object, never a copy of the recommendation and never a wall of
 * generated text. Mirrors `functions/src/campaign` wire shapes; change them
 * together.
 *
 * Nearly every field is nullable: a campaign must be able to exist with
 * unknowns, because inventing a price or an audience to fill a field is the
 * one thing MARKA never does. Provenance rides on the fields where it
 * matters (`basis`), and `userEdited` records which fields the owner has
 * taken authority over — an AI update never silently reverts those.
 */
export interface Campaign extends OwnedEntity {
  businessId: EntityId
  /** The conversation the campaign was built in; null outside chat. */
  conversationId: EntityId | null
  /**
   * Traceability back to the recommendation this was built from. Written
   * only by Cloud Functions — security rules refuse it on client creates.
   */
  sourceRecommendationId: EntityId | null
  name: string
  status: CampaignStatus
  objective: string | null
  targetAudience: CampaignAudience | null
  offer: CampaignOffer | null
  positioning: string | null
  keyMessage: string | null
  callToAction: string | null
  channels: CampaignChannel[]
  /** A recommendation, not a known optimum. */
  durationDays: number | null
  startDate: Millis | null
  endDate: Millis | null
  notes: string | null
  /** What this campaign quietly relies on. Stated, never hidden. */
  assumptions: string[]
  /** What is not established and must not be invented. */
  unknowns: string[]
  /** Fields the owner has edited; AI updates must not silently revert them. */
  userEdited: CampaignEditableField[]
  /** Model/latency of the build or last AI edit; never shown to the user. */
  meta: CampaignMeta | null
}

/** Draft until the owner promotes it. No active/paused lifecycle yet. */
export type CampaignStatus = 'draft' | 'ready' | 'archived'

/** Same channel vocabulary as recommendations — one list, not two. */
export type CampaignChannel =
  | 'facebook'
  | 'instagram'
  | 'whatsapp'
  | 'tiktok'
  | 'in_store'
  | 'website'

/** 'known' only when the Business Brain establishes the audience. */
export interface CampaignAudience {
  description: string
  basis: 'known' | 'hypothesis'
}

/** 'existing' only for an offer the Business Brain actually records. */
export interface CampaignOffer {
  description: string
  basis: 'existing' | 'recommendation'
}

export interface CampaignMeta {
  model: string | null
  task: string | null
  latencyMs: number | null
  usage: { inputTokens: number; outputTokens: number } | null
}

export const CAMPAIGN_EDITABLE_FIELDS = [
  'name',
  'objective',
  'targetAudience',
  'offer',
  'positioning',
  'keyMessage',
  'callToAction',
  'channels',
  'durationDays',
  'startDate',
  'endDate',
  'notes',
] as const
export type CampaignEditableField = (typeof CAMPAIGN_EDITABLE_FIELDS)[number]

/**
 * Channel vocabulary used by the Calendar tab's items. Kept from the
 * scaffolding phase — calendar entries can point at channels (like Google)
 * that campaign strategy does not target yet.
 */
export type CampaignChannelKind =
  | 'instagram'
  | 'facebook'
  | 'whatsapp'
  | 'tiktok'
  | 'google'
  | 'in_store'
  | 'other'
