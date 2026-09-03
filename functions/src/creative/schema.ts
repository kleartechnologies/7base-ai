/**
 * JSON schemas for the two creative model calls.
 *
 * Both run on the fast tier: creative copy inherits the campaign's strategy,
 * so these calls are wording, not judgement. The copy schema is text fields
 * only — it cannot express audience, offer, channels or provenance, so
 * nothing it returns can move strategy. The edit schema is a patch: null
 * means "leave this field alone", and `validate.ts` plus `applyCreativePatch`
 * treat everything present as untrusted input.
 *
 * Strict-mode rules: every property required, additionalProperties false,
 * optionality as nullable types, lengths validated after.
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

export const CREATIVE_COPY_SCHEMA_NAME = 'creative_copy'

export const CREATIVE_COPY_SCHEMA = object({
  /** Short internal name for this creative, e.g. "Lunch Set Poster". */
  name: nullableString,
  /** The poster's main line. Short and concrete. */
  headline: nullableString,
  /** One supporting line under the headline, or null. */
  subheadline: nullableString,
  /** Short imperative matching the campaign's call to action. */
  callToAction: nullableString,
  /** The offer as displayable poster text, or null when there is no offer. */
  offerText: nullableString,
  facebookCaption: nullableString,
  instagramCaption: nullableString,
  /** One or two sentences usable anywhere — stories, flyers, replies. */
  shortCopy: nullableString,
  /** A WhatsApp broadcast message, or null if the channel is not in play. */
  whatsappCopy: nullableString,
  /** What the supporting visual should show. Scene only — never words. */
  imageBrief: nullableString,
  /** Accessibility description of that visual. */
  altText: nullableString,
})

export const CREATIVE_EDIT_SCHEMA_NAME = 'creative_edit'

export const CREATIVE_EDIT_SCHEMA = object({
  /** One or two short sentences to the owner about what changed. */
  reply: { type: 'string' },
  name: nullableString,
  headline: nullableString,
  subheadline: nullableString,
  body: nullableString,
  callToAction: nullableString,
  offerText: nullableString,
  facebookCaption: nullableString,
  instagramCaption: nullableString,
  shortCopy: nullableString,
  whatsappCopy: nullableString,
  /**
   * Null unless the instruction asks for a *visual* change. When set, a new
   * image brief — this is the only path that regenerates the poster image;
   * copy-only edits must leave it null so text changes never cost an image.
   */
  visualChange: nullableString,
})
