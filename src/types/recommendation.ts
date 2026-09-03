import type { MessageMeta } from './chat'
import type { EntityId, OwnedEntity } from './common'

/**
 * A persisted marketing recommendation — MARKA's structured answer to a
 * marketing goal, produced by the backend intelligence engine.
 *
 * Mirrors `functions/src/marketing` wire shapes; change them together. The
 * scheme every field obeys: facts, inferences and recommendations are
 * distinguished explicitly (`kind`, `basis`), impact is qualitative because
 * MARKA has no sales data, and anything unknown is listed rather than
 * invented. Written only by Cloud Functions; the client can read and delete,
 * never create or edit.
 */

export type RecommendationConfidence = 'low' | 'medium' | 'high'
export type OpportunityImpact =
  | 'high_potential'
  | 'moderate_potential'
  | 'low_potential'
  | 'unknown'
export type OpportunityEffort = 'low' | 'medium' | 'high'
export type RationaleKind = 'fact' | 'inference' | 'recommendation'
export type RecommendationNextAction =
  | 'build_campaign'
  | 'confirm_business_info'
  | 'clarify_goal'
export type RecommendationChannel =
  | 'facebook'
  | 'instagram'
  | 'whatsapp'
  | 'tiktok'
  | 'in_store'
  | 'website'

export interface MarketingOpportunity {
  title: string
  description: string
  /** Short statements grounded in the Business Brain. */
  evidence: string[]
  /** What must be true for this to work but is not established. */
  assumptions: string[]
  potentialImpact: OpportunityImpact
  effort: OpportunityEffort
  suitability: string | null
}

export interface RecommendationRationale {
  statement: string
  kind: RationaleKind
  /** Internal Business Brain area reference; never shown as a raw path. */
  basedOn: string | null
}

export interface MarketingRecommendation extends OwnedEntity {
  businessId: EntityId
  conversationId: EntityId
  /** 'proposed' until the campaign phase acts on it. */
  status: 'proposed'
  ownerSummary: string
  goal: string
  diagnosis: { statement: string; basis: 'evidence' | 'hypothesis' }
  opportunities: MarketingOpportunity[]
  recommendedIndex: number
  rationale: RecommendationRationale[]
  targetAudience: { description: string; basis: 'known' | 'hypothesis' } | null
  offer: { description: string; basis: 'existing' | 'recommendation' } | null
  positioning: string | null
  coreMessage: string | null
  callToAction: string | null
  channels: RecommendationChannel[]
  durationDays: number | null
  confidence: RecommendationConfidence
  confidenceReason: string | null
  assumptions: string[]
  unknowns: string[]
  nextAction: RecommendationNextAction
  meta: MessageMeta | null
}
