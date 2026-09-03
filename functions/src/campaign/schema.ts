/**
 * JSON schemas for the two campaign model calls.
 *
 * Both run on the fast tier and both are deliberately tiny. The polish schema
 * is copy only — it *cannot* express audience, offer, channels or duration,
 * so nothing it returns can move provenance. The edit schema expresses a
 * patch: null means "leave this field alone", and `validate.ts` plus
 * `applyCampaignPatch` treat everything present as untrusted input.
 *
 * Strict-mode rules: every property required, additionalProperties false,
 * optionality as nullable types, no numeric ranges (validated after).
 */

const nullableString = { type: ['string', 'null'] } as const

function object<T extends Record<string, unknown>>(properties: T) {
  return {
    type: 'object',
    additionalProperties: false,
    required: Object.keys(properties),
    properties,
  } as const
}

function nullableObject<T extends Record<string, unknown>>(properties: T) {
  return {
    type: ['object', 'null'],
    additionalProperties: false,
    required: Object.keys(properties),
    properties,
  } as const
}

const CHANNEL_ENUM = ['facebook', 'instagram', 'whatsapp', 'tiktok', 'in_store', 'website']

export const CAMPAIGN_POLISH_SCHEMA_NAME = 'campaign_polish'

export const CAMPAIGN_POLISH_SCHEMA = object({
  /** Short, specific campaign name — at most six words. Null keeps the draft's. */
  name: nullableString,
  /** One sentence, in business terms. */
  objective: nullableString,
  /** One customer-facing line. Null keeps the recommendation's core message. */
  keyMessage: nullableString,
  /** Short imperative. Null keeps the recommendation's. */
  callToAction: nullableString,
  /** Operational note for the owner, or null. Never an invented fact. */
  notes: nullableString,
})

export const CAMPAIGN_EDIT_SCHEMA_NAME = 'campaign_edit'

export const CAMPAIGN_EDIT_SCHEMA = object({
  /** One or two short sentences to the owner about what changed. */
  reply: { type: 'string' },
  name: nullableString,
  objective: nullableString,
  /** Null = unchanged. Basis is re-clamped server-side regardless. */
  targetAudience: nullableObject({
    description: { type: 'string' },
    basis: { type: 'string', enum: ['known', 'hypothesis'] },
  }),
  offer: nullableObject({
    description: { type: 'string' },
    basis: { type: 'string', enum: ['existing', 'recommendation'] },
  }),
  positioning: nullableString,
  keyMessage: nullableString,
  callToAction: nullableString,
  /** Null = unchanged; an array replaces the whole list. */
  channels: { type: ['array', 'null'], items: { type: 'string', enum: CHANNEL_ENUM } },
  durationDays: { type: ['number', 'null'] },
  notes: nullableString,
})
