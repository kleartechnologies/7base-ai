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

/**
 * The one deterministic EVA suggestion — no AI call, just state:
 * a draft asks to be completed, a ready campaign without creatives asks for
 * the first one, a ready campaign with creatives offers another. Archived
 * campaigns get no nudge, and a suggestion that depends on the creative list
 * waits for the list instead of guessing.
 */
export type WorkspaceSuggestion = 'complete_draft' | 'first_creative' | 'another_creative'

export function workspaceSuggestion(
  campaign: Campaign,
  creativeCount: number | null,
): WorkspaceSuggestion | null {
  if (campaign.status === 'archived') return null
  if (campaign.status === 'draft') return 'complete_draft'
  if (creativeCount === null) return null
  return creativeCount === 0 ? 'first_creative' : 'another_creative'
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
