import { runStructuredTask } from '../ai/orchestrator'
import type { SubscriptionPlan } from '../config/models'
import type { StoredCampaign } from '../campaign/store'
import type { MessageMeta } from '../lib/types'
import { buildCreativeEditInput, CREATIVE_EDIT_PROMPT } from './prompt'
import { CREATIVE_EDIT_SCHEMA, CREATIVE_EDIT_SCHEMA_NAME } from './schema'
import type { StoredCreative } from './store'
import {
  CREATIVE_LIMITS,
  text,
  validateCreativeEdit,
  type CreativeEditableField,
  type CreativeEditDraft,
  type CreativePatch,
} from './validate'

/**
 * Conversational creative editing.
 *
 * "Make the headline more premium" must update the structured creative, not
 * repaint a flattened image. The model proposes a *patch* — only the fields
 * the instruction requires — and this module decides what actually changes,
 * with the same authority model campaigns use (`userEdited`): every field a
 * user instruction touches becomes owner-set, and an assistant-sourced
 * update can never silently revert one. Not a second authority system — the
 * same one, applied to creative copy fields.
 *
 * Copy edits never touch the image. Only a non-null `visualChange` from the
 * validated edit triggers regeneration, and the caller handles that
 * separately — a wording change must never cost the owner an image call.
 */

export type PatchSource = 'user_instruction' | 'assistant'

export interface AppliedCreativePatch {
  creative: StoredCreative
  changed: CreativeEditableField[]
}

export function applyCreativePatch(
  creative: StoredCreative,
  patch: CreativePatch,
  source: PatchSource,
  now = Date.now(),
): AppliedCreativePatch {
  const next: StoredCreative = {
    ...creative,
    content: { ...creative.content },
    captions: { ...creative.captions },
  }
  const changed: CreativeEditableField[] = []

  const locked = (field: CreativeEditableField): boolean =>
    source === 'assistant' && creative.userEdited.includes(field)

  const consider = (
    field: CreativeEditableField,
    current: string | null,
    apply: (value: string) => void,
  ): void => {
    const value = patch[field]
    if (value === undefined || locked(field) || value === current) return
    apply(value)
    changed.push(field)
  }

  consider('name', creative.name, (value) => (next.name = value))
  consider('headline', creative.content.headline, (value) => (next.content.headline = value))
  consider(
    'subheadline',
    creative.content.subheadline,
    (value) => (next.content.subheadline = value),
  )
  consider('body', creative.content.body, (value) => (next.content.body = value))
  consider(
    'callToAction',
    creative.content.callToAction,
    (value) => (next.content.callToAction = value),
  )
  consider('offerText', creative.content.offerText, (value) => (next.content.offerText = value))
  consider(
    'facebookCaption',
    creative.captions.facebook,
    (value) => (next.captions.facebook = value),
  )
  consider(
    'instagramCaption',
    creative.captions.instagram,
    (value) => (next.captions.instagram = value),
  )
  consider('shortCopy', creative.captions.short, (value) => (next.captions.short = value))
  consider('whatsappCopy', creative.captions.whatsapp, (value) => (next.captions.whatsapp = value))

  if (changed.length > 0) {
    next.updatedAt = now
    if (source === 'user_instruction') {
      next.userEdited = [...new Set([...creative.userEdited, ...changed])]
    }
  }

  return { creative: next, changed }
}

/**
 * A standing constraint hidden in an instruction: "don't mention discounts",
 * "never use emoji", "jangan letak harga". Recorded on the creative so every
 * later copy call still honours it — deterministically carried forward, not
 * left to the model's memory of the thread.
 */
export function extractDirective(instruction: string): string | null {
  const clean = text(instruction, CREATIVE_LIMITS.directive)
  if (!clean) return null
  const standing =
    /\b(?:don'?t|do not|never|stop|avoid|without)\b|\bno (?:discounts?|prices?|emojis?|hashtags?|slang)\b|\bjangan\b|\btak (?:nak|mahu|payah)\b/i
  return standing.test(clean) ? clean : null
}

/** Appends a directive, deduplicated, newest last, capped. */
export function withDirective(directives: string[], directive: string | null): string[] {
  if (!directive) return directives
  const key = directive.toLowerCase()
  if (directives.some((entry) => entry.toLowerCase() === key)) return directives
  return [...directives, directive].slice(-CREATIVE_LIMITS.directives)
}

export interface CreativeEditOutcome {
  draft: CreativeEditDraft
  meta: MessageMeta
}

export async function generateCreativeEdit(params: {
  instruction: string
  creative: StoredCreative
  campaign: StoredCampaign | null
  businessName: string | null
  /** Grounding corpus; the instruction itself is already included by callers. */
  corpus: string
  /** Server-resolved subscription plan, from the callable boundary. */
  plan: SubscriptionPlan
}): Promise<CreativeEditOutcome> {
  const { data, meta } = await runStructuredTask<unknown>({
    task: 'creative.edit',
    plan: params.plan,
    systemPrompt: CREATIVE_EDIT_PROMPT,
    input: buildCreativeEditInput(params),
    schema: {
      name: CREATIVE_EDIT_SCHEMA_NAME,
      schema: CREATIVE_EDIT_SCHEMA as unknown as Record<string, unknown>,
    },
  })

  return { draft: validateCreativeEdit(data, params.corpus), meta }
}
