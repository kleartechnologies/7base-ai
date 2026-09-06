import { PROVENANCE_FIELDS } from '../../lib/business.types'

/**
 * The JSON schema the model must fill in.
 *
 * MARKA does not ask for prose and then parse it. The Responses API is given a
 * strict schema, so the model returns a shape the code already understands —
 * the difference between "usually works" and "cannot silently drift".
 *
 * Strict mode rules, which the schema below obeys:
 *  - every property appears in `required`
 *  - `additionalProperties: false` everywhere
 *  - optionality is expressed as a nullable type, never a missing key
 *  - no `minimum`/`maximum`/`maxItems`; ranges and lengths are enforced by
 *    `validate.ts` after the fact
 */

export const nullableString = { type: ['string', 'null'] } as const
export const stringArray = { type: 'array', items: { type: 'string' } } as const

export function object<T extends Record<string, unknown>>(properties: T) {
  return {
    type: 'object',
    additionalProperties: false,
    required: Object.keys(properties),
    properties,
  } as const
}

export const WEBSITE_ANALYSIS_SCHEMA_NAME = 'business_website_analysis'

export const WEBSITE_ANALYSIS_SCHEMA = object({
  identity: object({
    businessName: nullableString,
    legalName: nullableString,
    tagline: nullableString,
    description: nullableString,
    category: nullableString,
    subIndustry: nullableString,
    businessType: nullableString,
    industry: { type: 'string', enum: ['food_and_beverage', 'other'] },
  }),

  location: object({
    addressLine1: nullableString,
    city: nullableString,
    state: nullableString,
    postcode: nullableString,
    countryCode: nullableString,
    serviceArea: nullableString,
    openingHours: nullableString,
  }),

  contact: object({
    email: nullableString,
    phone: nullableString,
    whatsapp: nullableString,
    socialProfiles: {
      type: 'array',
      items: object({
        platform: {
          type: 'string',
          enum: ['facebook', 'instagram', 'tiktok', 'google', 'other'],
        },
        handle: nullableString,
        url: { type: 'string' },
      }),
    },
  }),

  products: {
    type: 'array',
    items: object({
      name: { type: 'string' },
      description: nullableString,
      // Major units as printed on the page (18.90), converted to sen on save.
      price: { type: ['number', 'null'] },
      currency: nullableString,
      category: nullableString,
      attributes: stringArray,
      isSignature: { type: 'boolean' },
      sourceUrl: nullableString,
      confidence: { type: 'number' },
    }),
  },

  audience: object({
    summary: nullableString,
    customerTypes: stringArray,
    demographics: stringArray,
    useCases: stringArray,
    needs: stringArray,
    preferences: stringArray,
    segments: {
      type: 'array',
      items: object({
        label: { type: 'string' },
        description: nullableString,
        traits: stringArray,
      }),
    },
    sourceUrl: nullableString,
    confidence: { type: 'number' },
  }),

  brand: object({
    voice: nullableString,
    personalityTraits: stringArray,
    visualStyle: nullableString,
    keyMessages: stringArray,
    valuePropositions: stringArray,
    sourceUrl: nullableString,
    confidence: { type: 'number' },
  }),

  marketing: object({
    positioning: nullableString,
    valueProposition: nullableString,
    differentiators: stringArray,
    activeChannels: stringArray,
    promotions: stringArray,
    callsToAction: stringArray,
    themes: stringArray,
    emphasizedProducts: stringArray,
    sourceUrl: nullableString,
    confidence: { type: 'number' },
  }),

  operations: object({
    openingHours: nullableString,
    orderingMethods: stringArray,
    deliveryPlatforms: stringArray,
    reservations: nullableString,
    notes: stringArray,
    sourceUrl: nullableString,
    confidence: { type: 'number' },
  }),

  /**
   * Per-fact provenance. The field name is an enum so the model cannot invent
   * paths that do not exist on the Business Brain.
   */
  fieldSources: {
    type: 'array',
    items: object({
      field: { type: 'string', enum: [...PROVENANCE_FIELDS] },
      sourceUrl: nullableString,
      confidence: { type: 'number' },
    }),
  },

  /** Things the website did not answer. Stated, not guessed at. */
  unknowns: stringArray,

  /** One short paragraph for the review screen, in MARKA's voice. */
  summary: { type: 'string' },
})
