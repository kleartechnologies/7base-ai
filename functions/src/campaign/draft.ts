import type { StoredRecommendation } from '../marketing/store'
import { recommendedOpportunity } from '../marketing/validate'
import {
  CAMPAIGN_LIMITS,
  dedupeList,
  type CampaignContent,
  type CampaignPolishDraft,
} from './validate'

/**
 * Recommendation → campaign, deterministically.
 *
 * The authority-bearing fields — audience, offer, channels, duration,
 * positioning, assumptions, unknowns — are *copied* from the recommendation,
 * never regenerated. A model call cannot upgrade "my hypothesis about your
 * customers" into "your customers", because those fields never pass through a
 * model on this path. The campaign inherits exactly the authority the
 * recommendation earned, which is the whole grounding argument for building.
 *
 * What is not established stays visible: assumptions and unknowns ride along
 * so "confirm pricing before launch" is on the campaign, not lost in chat.
 */
export function draftCampaignFromRecommendation(rec: StoredRecommendation): CampaignContent {
  const opportunity = recommendedOpportunity(rec)

  return {
    name: opportunity.title,
    objective: rec.goal,
    targetAudience: rec.targetAudience ? { ...rec.targetAudience } : null,
    offer: rec.offer ? { ...rec.offer } : null,
    positioning: rec.positioning,
    keyMessage: rec.coreMessage,
    callToAction: rec.callToAction,
    channels: [...rec.channels],
    durationDays: rec.durationDays,
    startDate: null,
    endDate: null,
    notes: null,
    assumptions: dedupeList(
      [...rec.assumptions, ...opportunity.assumptions],
      CAMPAIGN_LIMITS.assumptions,
    ),
    unknowns: dedupeList([...rec.unknowns], CAMPAIGN_LIMITS.unknowns),
  }
}

/**
 * Folds the fast-tier polish into the deterministic draft. Copy fields only —
 * a null keeps the draft's value, and audience/offer/channels/duration are
 * not in the polish shape at all, so this merge cannot move provenance.
 */
export function mergePolish(
  content: CampaignContent,
  polish: CampaignPolishDraft,
): CampaignContent {
  return {
    ...content,
    name: polish.name ?? content.name,
    objective: polish.objective ?? content.objective,
    keyMessage: polish.keyMessage ?? content.keyMessage,
    callToAction: polish.callToAction ?? content.callToAction,
    notes: polish.notes ?? content.notes,
  }
}
