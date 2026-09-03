import type { CampaignCardBlock, MessageBlock } from '../lib/types'
import type { StoredCampaign } from './store'
import type { CampaignEditableField } from './validate'

/**
 * How a campaign appears in the thread: a short sentence in MARKA's voice —
 * MARKA did the work, the owner reviews it — plus a structured card that
 * *references* the persisted campaign and duplicates only what it renders.
 */

/**
 * When an edit-like message references a campaign this conversation does not
 * have. Canned and honest; a model call cannot improve "there is nothing to
 * edit here".
 */
export const CAMPAIGN_CLARIFICATION_REPLY =
  'I’m not sure which campaign you mean — this conversation doesn’t have one yet. Ask me for a marketing recommendation and I’ll build the campaign from it, or open an existing one from the Campaigns tab and continue there.'

export interface CampaignPresentation {
  blocks: MessageBlock[]
  plainText: string
}

export function buildCampaignCardBlock(
  id: string,
  campaignId: string,
  campaign: StoredCampaign,
): CampaignCardBlock {
  return {
    id,
    type: 'campaign_card',
    campaignId,
    name: campaign.name,
    status: campaign.status,
    objective: campaign.objective,
    audience: campaign.targetAudience,
    offer: campaign.offer,
    keyMessage: campaign.keyMessage,
    callToAction: campaign.callToAction,
    channels: campaign.channels,
    durationDays: campaign.durationDays,
  }
}

export function buildCampaignBuiltPresentation(
  campaignId: string,
  campaign: StoredCampaign,
): CampaignPresentation {
  const lead =
    'I’ve turned that recommendation into a campaign draft. Everything here is editable — tell me what to change, or open it from the Campaigns tab.'
  return {
    blocks: [
      { id: 'b0', type: 'text', text: lead },
      buildCampaignCardBlock('b1', campaignId, campaign),
    ],
    plainText: `${lead}\n\nCampaign: ${campaign.name}`,
  }
}

export function buildCampaignEditPresentation(
  campaignId: string,
  campaign: StoredCampaign,
  reply: string | null,
  changed: CampaignEditableField[],
): CampaignPresentation {
  const lead =
    reply ??
    (changed.length > 0
      ? 'Done — I’ve updated the campaign.'
      : 'I looked at the campaign and didn’t change anything for that.')
  return {
    blocks: [
      { id: 'b0', type: 'text', text: lead },
      buildCampaignCardBlock('b1', campaignId, campaign),
    ],
    plainText: `${lead}\n\nCampaign: ${campaign.name}`,
  }
}
