import type { EntityId, Millis, OwnedEntity } from './common'
import type { CampaignChannelKind } from './campaign'

/**
 * A dated marketing action. Campaign schedule slots are projected into this
 * collection so the Calendar tab has one thing to read.
 */
export interface CalendarItem extends OwnedEntity {
  businessId: EntityId
  campaignId: EntityId | null
  creativeId: EntityId | null
  title: string
  notes: string | null
  channel: CampaignChannelKind | null
  scheduledAt: Millis
  status: CalendarItemStatus
}

export type CalendarItemStatus = 'planned' | 'scheduled' | 'published' | 'skipped'
