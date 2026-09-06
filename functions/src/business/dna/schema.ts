import { nullableString, object, stringArray, WEBSITE_ANALYSIS_SCHEMA } from '../brain/schema'

/**
 * The Business DNA schema (Phase 7E): the whole website-analysis schema —
 * identity, location, contact, products, audience, brand, marketing,
 * operations, provenance, summary, unknowns — plus one `brandDna` block for
 * what the model can read off the visual evidence.
 *
 * Reusing the base schema is the point. The business half of the DNA is
 * exactly what the Business Brain already stores and the owner already
 * reviews, so it merges through the same code with the same authority rules.
 * Strict-mode rules (see brain/schema.ts) apply to the addition too.
 */

export const BUSINESS_DNA_SCHEMA_NAME = 'business_dna'

const confidenceLevel = { type: 'string', enum: ['high', 'medium', 'low'] } as const

export const BRAND_DNA_SCHEMA = object({
  /** The id (img1, img2, …) of the attached image that is the logo, or null. */
  logoImageId: nullableString,
  colors: {
    type: 'array',
    items: object({
      hex: { type: 'string' },
      confidence: confidenceLevel,
      /** Where it was seen: an image id, or "markup" for an extracted colour. */
      seenIn: { type: 'string' },
    }),
  },
  /** Only a font the evidence NAMES. Never guessed from an image. */
  detectedFont: nullableString,
  /** What the type looks like in the images: "rounded sans-serif, bold headings". */
  typographyNotes: nullableString,
  visualStyle: nullableString,
  styleTraits: stringArray,
  imageryStyle: nullableString,
  compositionStyle: nullableString,
  visualMood: nullableString,
  confidence: confidenceLevel,
})

export const BUSINESS_DNA_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [...WEBSITE_ANALYSIS_SCHEMA.required, 'brandDna'],
  properties: {
    ...WEBSITE_ANALYSIS_SCHEMA.properties,
    brandDna: BRAND_DNA_SCHEMA,
  },
} as const
