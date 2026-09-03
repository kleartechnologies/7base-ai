import type { StoredBusiness } from '../lib/business.types'
import type { RecommendationConfidence } from './validate'

/**
 * How much the Business Brain can actually carry.
 *
 * Confidence must reflect evidence quality, not how confident the model
 * sounds — and the model cannot be trusted to grade its own evidence. So the
 * grade is computed here, from what the Brain demonstrably contains, and used
 * to clamp whatever confidence the model claimed.
 */

export type BrainRichness = 'missing' | 'sparse' | 'grounded'

/**
 * Scores the Brain on what a marketing recommendation can lean on: identity,
 * location, products, and the discovered sections — with confirmed sections
 * worth double, because the owner has vouched for them (the same authority
 * rule the Brain itself uses).
 */
export function assessBrainRichness(business: StoredBusiness | null): BrainRichness {
  if (!business) return 'missing'

  let score = 0

  if (business.identity?.description) score += 1
  if (
    business.identity?.category ||
    business.identity?.businessType ||
    business.identity?.subIndustry
  ) {
    score += 1
  }
  if (business.location?.city || business.location?.serviceArea) score += 1
  if (business.location?.openingHours || business.operations?.value?.openingHours) score += 1

  const productCount = Array.isArray(business.products) ? business.products.length : 0
  if (productCount > 0) score += 1
  if (productCount >= 5) score += 1

  for (const section of [business.audience, business.brand, business.marketing]) {
    if (section?.value) {
      score += 1
      if (section.confirmed) score += 1
    }
  }

  if (score === 0) return 'missing'
  return score < 4 ? 'sparse' : 'grounded'
}

const CONFIDENCE_RANK: Record<RecommendationConfidence, number> = {
  low: 0,
  medium: 1,
  high: 2,
}

/**
 * The ceiling evidence puts on confidence.
 *
 * A recommendation built on a sparse Brain may be sensible, but it cannot be
 * *high confidence* no matter how sure the model sounds; one built on nothing
 * is a guess and says so. Confidence is only ever lowered here — a cautious
 * model is never overruled upward.
 */
export function clampConfidence(
  claimed: RecommendationConfidence,
  richness: BrainRichness,
): RecommendationConfidence {
  const ceiling: RecommendationConfidence =
    richness === 'missing' ? 'low' : richness === 'sparse' ? 'medium' : 'high'
  return CONFIDENCE_RANK[claimed] <= CONFIDENCE_RANK[ceiling] ? claimed : ceiling
}
