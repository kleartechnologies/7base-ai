import { buildBusinessContext } from '../ai/context'
import { runStructuredTask, type OrchestrationTurn } from '../ai/orchestrator'
import type { SubscriptionPlan } from '../config/models'
import type { StoredBusiness } from '../lib/business.types'
import type { MessageMeta } from '../lib/types'
import { assessBrainRichness, clampConfidence, type BrainRichness } from './grounding'
import { buildMarketingInput, MARKETING_INTELLIGENCE_PROMPT } from './prompt'
import {
  MARKETING_RECOMMENDATION_SCHEMA,
  MARKETING_RECOMMENDATION_SCHEMA_NAME,
} from './schema'
import {
  validateMarketingRecommendation,
  type MarketingRecommendationDraft,
} from './validate'

/**
 * The marketing intelligence engine.
 *
 * Business Brain supplies context, this module supplies reasoning, chat
 * supplies presentation, campaigns will supply execution — this file is only
 * the middle step. It is thin on purpose: the judgement lives in the prompt,
 * the scepticism in the validator, and the honesty about evidence in the
 * grounding clamp, each testable on its own.
 *
 * Runs on the `campaign.diagnose` task, which the model routing table already
 * points at the reasoning tier. No model id appears here.
 */

export interface RecommendationOutcome {
  draft: MarketingRecommendationDraft
  meta: MessageMeta
  richness: BrainRichness
}

export async function generateMarketingRecommendation(params: {
  goal: string
  business: StoredBusiness
  /** Prior turns, oldest first, excluding the goal message itself. */
  recentTurns: OrchestrationTurn[]
  /** The authenticated owner, for the usage guardrail. */
  uid: string
  /** Server-resolved subscription plan, from the callable boundary. */
  plan: SubscriptionPlan
}): Promise<RecommendationOutcome> {
  const richness = assessBrainRichness(params.business)

  const { data, meta } = await runStructuredTask<unknown>({
    task: 'campaign.diagnose',
    uid: params.uid,
    plan: params.plan,
    systemPrompt: MARKETING_INTELLIGENCE_PROMPT,
    input: buildMarketingInput({
      goal: params.goal,
      businessContext: buildBusinessContext(params.business),
      recentTurns: params.recentTurns,
    }),
    schema: {
      name: MARKETING_RECOMMENDATION_SCHEMA_NAME,
      schema: MARKETING_RECOMMENDATION_SCHEMA as unknown as Record<string, unknown>,
    },
  })

  const draft = validateMarketingRecommendation(data)

  return {
    // However confident the model sounded, the evidence sets the ceiling.
    draft: { ...draft, confidence: clampConfidence(draft.confidence, richness) },
    meta,
    richness,
  }
}
