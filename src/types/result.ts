import type { EntityId, Millis, OwnedEntity } from './common'

/**
 * A point-in-time performance reading for a campaign.
 *
 * Kept as an append-only series rather than a mutable total so MARKA can
 * eventually reason about trend, not just final numbers.
 */
export interface ResultEntry extends OwnedEntity {
  businessId: EntityId
  campaignId: EntityId
  periodStart: Millis
  periodEnd: Millis
  metrics: ResultMetrics
  source: 'manual' | 'meta' | 'google' | 'other'
  notes: string | null
}

export interface ResultMetrics {
  impressions: number | null
  reach: number | null
  engagements: number | null
  clicks: number | null
  conversions: number | null
  spendMinor: number | null
  revenueMinor: number | null
  currency: string
}
