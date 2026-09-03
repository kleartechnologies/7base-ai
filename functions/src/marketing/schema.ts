/**
 * The JSON schema for a marketing recommendation.
 *
 * Same posture as the Business Brain schema: the Responses API is given a
 * strict schema so the model returns a shape the code already understands,
 * and `validate.ts` then treats the *contents* as untrusted input.
 *
 * Strict mode rules, which the schema below obeys:
 *  - every property appears in `required`
 *  - `additionalProperties: false` everywhere
 *  - optionality is expressed as a nullable type, never a missing key
 *  - no `minimum`/`maximum`/`maxItems`; ranges and lengths are enforced by
 *    `validate.ts` after the fact
 *
 * Deliberately small. Phase 2 showed that output size, not input size, is
 * where reasoning latency goes — so this schema asks only for what the
 * recommendation card and the campaign phase actually need, and every prose
 * field is expected to be short.
 */

const nullableString = { type: ['string', 'null'] } as const
const stringArray = { type: 'array', items: { type: 'string' } } as const

function object<T extends Record<string, unknown>>(properties: T) {
  return {
    type: 'object',
    additionalProperties: false,
    required: Object.keys(properties),
    properties,
  } as const
}

export const MARKETING_RECOMMENDATION_SCHEMA_NAME = 'marketing_recommendation'

export const MARKETING_RECOMMENDATION_SCHEMA = object({
  /** 1–3 short sentences MARKA says in the chat, in its own voice. */
  ownerSummary: { type: 'string' },

  /** The owner's goal as MARKA understood it, restated in one line. */
  goal: { type: 'string' },

  /**
   * What appears to be the marketing problem or opportunity. `basis` is the
   * honesty flag: 'evidence' only when the Business Brain actually supports
   * the statement, 'hypothesis' when it is a reasonable reading of a thin
   * picture.
   */
  diagnosis: object({
    statement: { type: 'string' },
    basis: { type: 'string', enum: ['evidence', 'hypothesis'] },
  }),

  /**
   * The openings MARKA sees. Between one and four; quality over coverage.
   * Impact is qualitative on purpose — MARKA has no sales data, so a number
   * here could only be invented.
   */
  opportunities: {
    type: 'array',
    items: object({
      title: { type: 'string' },
      description: { type: 'string' },
      /** Short statements grounded in the Business Brain. */
      evidence: stringArray,
      /** What must be true for this to work but is not established. */
      assumptions: stringArray,
      potentialImpact: {
        type: 'string',
        enum: ['high_potential', 'moderate_potential', 'low_potential', 'unknown'],
      },
      effort: { type: 'string', enum: ['low', 'medium', 'high'] },
      /** Why this opening suits this particular business, one line. */
      suitability: nullableString,
    }),
  },

  /** Index into `opportunities` of the one MARKA recommends. */
  recommendedIndex: { type: 'number' },

  /**
   * Decision-relevant reasons for the recommendation — never chain-of-thought.
   * Each is tagged as fact, inference or recommendation, and names the part
   * of the Business Brain it leans on so provenance can become clickable.
   */
  rationale: {
    type: 'array',
    items: object({
      statement: { type: 'string' },
      kind: { type: 'string', enum: ['fact', 'inference', 'recommendation'] },
      /** e.g. 'products', 'location', 'audience'. Validated against a fixed set. */
      basedOn: nullableString,
    }),
  },

  /**
   * Null description means MARKA is not recommending an audience. 'known'
   * only when the Business Brain establishes it; otherwise 'hypothesis'.
   */
  targetAudience: object({
    description: nullableString,
    basis: { type: 'string', enum: ['known', 'hypothesis'] },
  }),

  /**
   * Null description means no offer is recommended. 'existing' only for an
   * offer the Business Brain records; a suggested one is 'recommendation'.
   */
  offer: object({
    description: nullableString,
    basis: { type: 'string', enum: ['existing', 'recommendation'] },
  }),

  positioning: nullableString,
  coreMessage: nullableString,
  callToAction: nullableString,

  channels: {
    type: 'array',
    items: {
      type: 'string',
      enum: ['facebook', 'instagram', 'whatsapp', 'tiktok', 'in_store', 'website'],
    },
  },

  /** Recommended test period in days, or null. A recommendation, not a fact. */
  durationDays: { type: ['number', 'null'] },

  /** Reflects evidence quality, not conviction. Clamped again server-side. */
  confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
  confidenceReason: nullableString,

  /** Assumptions the whole recommendation rests on. Stated, never hidden. */
  assumptions: stringArray,

  /** What MARKA does not know that would change or sharpen this advice. */
  unknowns: stringArray,

  nextAction: {
    type: 'string',
    enum: ['build_campaign', 'confirm_business_info', 'clarify_goal'],
  },
})
