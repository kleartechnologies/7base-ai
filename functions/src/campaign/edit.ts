import { runStructuredTask } from '../ai/orchestrator'
import type { SubscriptionPlan } from '../config/models'
import type { MessageMeta } from '../lib/types'
import { buildEditInput, CAMPAIGN_EDIT_PROMPT } from './prompt'
import { CAMPAIGN_EDIT_SCHEMA, CAMPAIGN_EDIT_SCHEMA_NAME } from './schema'
import type { StoredCampaign } from './store'
import {
  validateCampaignEdit,
  type CampaignAudience,
  type CampaignEditDraft,
  type CampaignEditableField,
  type CampaignOffer,
  type CampaignPatch,
} from './validate'

/**
 * Conversational campaign editing.
 *
 * "Make this more premium" must update the structured campaign, not replace
 * it with prose. The model proposes a *patch* — only the fields the
 * instruction requires — and this module decides what actually changes:
 *
 *  - Edit authority (`userEdited`): every field a user instruction changes is
 *    recorded as owner-set. A later `assistant`-sourced update can never
 *    overwrite an owner-set field, so "don't use discounts" survives
 *    unrelated AI updates deterministically, not by prompt discipline alone.
 *  - Basis clamp: an edited audience is a hypothesis and an edited offer is a
 *    recommendation unless the description is unchanged — nothing the model
 *    claims can promote a guess to 'known' or an idea to 'existing'.
 *
 * Runs on `campaign.edit`, which the routing table points at the fast tier:
 * applying one instruction to one structured object is a transformation, not
 * strategy.
 */

export type PatchSource = 'user_instruction' | 'assistant'

export interface AppliedPatch {
  campaign: StoredCampaign
  changed: CampaignEditableField[]
}

export function applyCampaignPatch(
  campaign: StoredCampaign,
  patch: CampaignPatch,
  source: PatchSource,
  now = Date.now(),
): AppliedPatch {
  const next: StoredCampaign = { ...campaign }
  const changed: CampaignEditableField[] = []

  const locked = (field: CampaignEditableField): boolean =>
    source === 'assistant' && campaign.userEdited.includes(field)

  const consider = <K extends keyof CampaignPatch & CampaignEditableField>(
    field: K,
    value: StoredCampaign[K],
  ): void => {
    if (locked(field)) return
    if (same(campaign[field], value)) return
    next[field] = value
    changed.push(field)
  }

  if (patch.name !== undefined) consider('name', patch.name)
  if (patch.objective !== undefined) consider('objective', patch.objective)
  if (patch.targetAudience !== undefined) {
    consider('targetAudience', clampAudience(campaign.targetAudience, patch.targetAudience))
  }
  if (patch.offer !== undefined) consider('offer', clampOffer(campaign.offer, patch.offer))
  if (patch.positioning !== undefined) consider('positioning', patch.positioning)
  if (patch.keyMessage !== undefined) consider('keyMessage', patch.keyMessage)
  if (patch.callToAction !== undefined) consider('callToAction', patch.callToAction)
  if (patch.channels !== undefined) consider('channels', patch.channels)
  if (patch.durationDays !== undefined) consider('durationDays', patch.durationDays)
  if (patch.notes !== undefined) consider('notes', patch.notes)

  if (changed.length > 0) {
    next.updatedAt = now
    if (source === 'user_instruction') {
      next.userEdited = [...new Set([...campaign.userEdited, ...changed])]
    }
  }

  return { campaign: next, changed }
}

/** A changed audience is a hypothesis; only an unchanged one keeps its basis. */
function clampAudience(
  current: CampaignAudience | null,
  incoming: CampaignAudience | null,
): CampaignAudience | null {
  if (!incoming) return incoming
  if (current && current.description === incoming.description) return current
  return { description: incoming.description, basis: 'hypothesis' }
}

/** A changed offer is a recommendation; only an unchanged one stays 'existing'. */
function clampOffer(
  current: CampaignOffer | null,
  incoming: CampaignOffer | null,
): CampaignOffer | null {
  if (!incoming) return incoming
  if (current && current.description === incoming.description) return current
  return { description: incoming.description, basis: 'recommendation' }
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

export interface CampaignEditOutcome {
  draft: CampaignEditDraft
  meta: MessageMeta
}

export async function generateCampaignEdit(params: {
  instruction: string
  campaign: StoredCampaign
  businessName: string | null
  /** Server-resolved subscription plan, from the callable boundary. */
  plan: SubscriptionPlan
}): Promise<CampaignEditOutcome> {
  const { data, meta } = await runStructuredTask<unknown>({
    task: 'campaign.edit',
    plan: params.plan,
    systemPrompt: CAMPAIGN_EDIT_PROMPT,
    input: buildEditInput(params),
    schema: {
      name: CAMPAIGN_EDIT_SCHEMA_NAME,
      schema: CAMPAIGN_EDIT_SCHEMA as unknown as Record<string, unknown>,
    },
  })

  return { draft: validateCampaignEdit(data), meta }
}
