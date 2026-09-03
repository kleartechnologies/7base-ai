import type { MessageBlock } from '../lib/types'
import { recommendedOpportunity, type MarketingRecommendationDraft } from './validate'

/**
 * Turns a validated recommendation into what the chat actually shows.
 *
 * Presentation is deliberately separate from the engine: the message carries a
 * short conversational lead-in plus a structured block that *references* the
 * persisted recommendation and duplicates only what the card needs to render.
 * The full object lives in Firestore, once.
 */

/**
 * What MARKA says when asked for strategy about a business it has not met.
 * Written server-side without a model call — the honest answer is fixed, and
 * a reasoning-tier invocation cannot improve it.
 */
export const MISSING_BRAIN_REPLY =
  'I’d like to help with that — but I don’t know enough about your business yet to give you real marketing advice. Set your business up from the Business tab, or tell me about it here, and I’ll get to work.'

export interface RecommendationPresentation {
  blocks: MessageBlock[]
  plainText: string
}

export function buildRecommendationPresentation(
  recommendationId: string,
  draft: MarketingRecommendationDraft,
): RecommendationPresentation {
  const opportunity = recommendedOpportunity(draft)

  // The card's "why": decision-relevant rationale, at most two statements.
  // Falls back to the diagnosis so the card never renders an empty reason.
  const why =
    draft.rationale
      .slice(0, 2)
      .map((entry) => entry.statement)
      .join(' ') || draft.diagnosis.statement

  return {
    blocks: [
      { id: 'b0', type: 'text', text: draft.ownerSummary },
      {
        id: 'b1',
        type: 'marketing_recommendation',
        recommendationId,
        title: opportunity.title,
        goal: draft.goal,
        diagnosis: draft.diagnosis.statement,
        why,
        audience: draft.targetAudience,
        offer: draft.offer,
        confidence: draft.confidence,
        nextAction: draft.nextAction,
      },
    ],
    plainText: `${draft.ownerSummary}\n\nRecommended focus: ${opportunity.title}`,
  }
}
