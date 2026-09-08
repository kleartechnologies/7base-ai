import { platformCopyEntries } from '@/features/creative/copyPlatforms'
import type { Campaign, Creative } from '@/types'

/**
 * Pure logic behind the Campaign Workspace (Phase 7E).
 *
 * Everything here is derived from stored data and nothing else — the progress
 * indicator and the EVA suggestion are honest reflections of what actually
 * exists, never a fake lifecycle. Kept out of the page component so it can be
 * unit-tested without a DOM.
 */

/** True when the campaign carries any real strategy substance. */
export function hasStrategy(campaign: Campaign): boolean {
  return Boolean(
    campaign.objective ||
      campaign.keyMessage ||
      campaign.positioning ||
      campaign.targetAudience ||
      campaign.offer,
  )
}

export interface CampaignProgress {
  strategy: boolean
  ready: boolean
  creative: boolean
}

/**
 * The three-step UX aid. `creativeCount` is null while the creatives listener
 * has not answered yet — an unloaded list never counts as "creative created".
 */
export function campaignProgress(
  campaign: Campaign,
  creativeCount: number | null,
): CampaignProgress {
  return {
    strategy: hasStrategy(campaign),
    ready: campaign.status === 'ready',
    creative: (creativeCount ?? 0) > 0,
  }
}

/** Whether this creative has any platform copy stored at all. */
export function hasPlatformCopy(creative: Creative): boolean {
  return platformCopyEntries(creative.captions).length > 0
}

/**
 * The single next useful thing to do with this campaign — no AI call, no
 * workflow engine, just the stored state read in a fixed order:
 *
 * - a draft asks for its strategy to be finished;
 * - a ready campaign with no creatives asks for the first one;
 * - a creative that has no copy at all is the gap worth pointing at, so the
 *   action leads to that creative rather than making yet another poster;
 * - otherwise the campaign is in good shape and can have another creative.
 *
 * Archived campaigns get nothing, and anything that depends on the creative
 * list waits for the list instead of guessing while it loads.
 */
export type CampaignNextAction =
  | { kind: 'edit_campaign' }
  | { kind: 'create_first' }
  | { kind: 'review_copy'; creativeId: string }
  | { kind: 'create_another' }

export function campaignNextAction(
  campaign: Campaign,
  creatives: Creative[] | null,
): CampaignNextAction | null {
  if (campaign.status === 'archived') return null
  if (campaign.status === 'draft') return { kind: 'edit_campaign' }
  if (creatives === null) return null
  if (creatives.length === 0) return { kind: 'create_first' }
  const withoutCopy = creatives.find((creative) => !hasPlatformCopy(creative))
  if (withoutCopy) return { kind: 'review_copy', creativeId: withoutCopy.id }
  return { kind: 'create_another' }
}

/** The owner's creatives that belong to this campaign; null while loading. */
export function campaignCreatives(
  creatives: Creative[] | null,
  campaignId: string,
): Creative[] | null {
  if (creatives === null) return null
  return creatives.filter((creative) => creative.campaignId === campaignId)
}

/**
 * What the header can honestly say about timing: a real date range when both
 * dates exist, the recommended length when only that exists, nothing else.
 */
export type CampaignDuration =
  | { type: 'range'; start: number; end: number }
  | { type: 'days'; days: number }
  | null

export function campaignDuration(campaign: Campaign): CampaignDuration {
  if (campaign.startDate && campaign.endDate) {
    return { type: 'range', start: campaign.startDate, end: campaign.endDate }
  }
  if (campaign.durationDays) return { type: 'days', days: campaign.durationDays }
  return null
}
