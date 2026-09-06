/**
 * The creative domain: types and validation.
 *
 * A creative is the *material* form of a campaign — structured copy plus one
 * supporting image, never a flattened PNG. Same validation posture as the
 * campaign and marketing engines: a JSON schema constrains the model's output
 * shape, and this module treats the contents as untrusted input.
 *
 * The extra rule creatives add is the money clamp. A campaign that says
 * "consider a weekday lunch set" must not become a poster that says
 * "RM19.90 Weekday Lunch Set": any money amount or percentage the model
 * writes must already appear in the grounding corpus (the campaign, the
 * Business Brain's products, or the owner's own instruction) or the field is
 * refused. This is enforced here, deterministically — never left to the
 * prompt alone.
 */

const LIMITS = {
  name: 80,
  headline: 80,
  subheadline: 140,
  body: 300,
  callToAction: 60,
  offerText: 80,
  facebookCaption: 600,
  instagramCaption: 500,
  shortCopy: 240,
  whatsappCopy: 400,
  imageBrief: 400,
  altText: 160,
  reply: 400,
  directive: 200,
  directives: 10,
} as const

export const CREATIVE_LIMITS = LIMITS

/** The two MVP poster shapes. Story/banner formats come later. */
export const CREATIVE_FORMATS = ['square_post', 'portrait_post'] as const
export type CreativeFormat = (typeof CREATIVE_FORMATS)[number]

export type CreativeStatus = 'draft' | 'generating' | 'ready' | 'failed'

export type CreativeLayout = 'image_top' | 'image_full_bleed' | 'text_only' | 'split'

export interface CreativeImageRef {
  /** Storage path, not a signed URL — URLs expire, paths do not. */
  storagePath: string | null
  /** The grounded prompt the image was generated from. Null for real assets. */
  prompt: string | null
  altText: string | null
  /** 'generated' imagery is never presented as a real product photo. */
  source: 'upload' | 'generated' | 'stock'
  /**
   * The business Asset this image was snapshotted from. Present only when
   * `source` is 'upload' and the image came from the Assets library — a
   * generated image never claims an asset. The path above is the creative's
   * own copy, so this reference survives the asset being archived or deleted.
   */
  assetId?: string
}

export interface CreativeContent {
  headline: string | null
  subheadline: string | null
  body: string | null
  callToAction: string | null
  offerText: string | null
  image: CreativeImageRef | null
  layout: CreativeLayout
}

/** Channel copy that travels with the poster. All optional by design. */
export interface CreativeCaptions {
  facebook: string | null
  instagram: string | null
  short: string | null
  whatsapp: string | null
}

export interface CreativeStyle {
  /** Falls back to the Business Brain's brand profile when null. */
  palette: string[] | null
  headingFont: string | null
  bodyFont: string | null
  logoStoragePath: string | null
  /**
   * The logo Asset `logoStoragePath` was snapshotted from, when the business
   * has a usable logo in its Assets. Server-set; the logo is composited onto
   * the poster client-side and is never sent to the image model.
   */
  logoAssetId?: string | null
  /**
   * Which parts of the owner's Brand Identity fed this creative. Server-set
   * at generation time; absent on creatives made before Phase 7D.
   */
  brandApplied?: {
    logo: boolean
    colors: boolean
    typography: boolean
    style: boolean
  } | null
}

/**
 * The flattened fields a user or an AI edit may change. `userEdited` records
 * which of these the owner has taken authority over — the same authority
 * model as campaigns, applied to the creative's copy fields.
 */
export const CREATIVE_EDITABLE_FIELDS = [
  'name',
  'headline',
  'subheadline',
  'body',
  'callToAction',
  'offerText',
  'facebookCaption',
  'instagramCaption',
  'shortCopy',
  'whatsappCopy',
] as const
export type CreativeEditableField = (typeof CREATIVE_EDITABLE_FIELDS)[number]

/** What the fast copy call may contribute. Every field is clamped after. */
export interface CreativeCopyDraft {
  name: string | null
  headline: string | null
  subheadline: string | null
  callToAction: string | null
  offerText: string | null
  facebookCaption: string | null
  instagramCaption: string | null
  shortCopy: string | null
  whatsappCopy: string | null
  /** Short description of the supporting visual, for the image prompt. */
  imageBrief: string | null
  altText: string | null
}

/** A validated set of changes. Absent key = untouched field. */
export type CreativePatch = Partial<Record<CreativeEditableField, string>>

/** A validated conversational edit: the patch plus MARKA's short reply. */
export interface CreativeEditDraft {
  reply: string | null
  patch: CreativePatch
  /** Non-null when the instruction asks for a visual change — regenerate. */
  visualChange: string | null
}

export class CreativeValidationError extends Error {
  constructor(reason: string) {
    super(`Creative output failed validation: ${reason}`)
    this.name = 'CreativeValidationError'
  }
}

/* --- grounding ---------------------------------------------------------- */

/**
 * Money and percentage tokens in a piece of copy, normalised for comparison.
 * "RM 19.90", "rm19,90" and "MYR19.90" all become "19.90"; "20 %" becomes
 * "20%". Digits are what matter — formatting must not let a claim through.
 */
export function moneyTokens(text: string): string[] {
  const tokens: string[] = []
  const money = text.matchAll(/(?:rm|myr)\s?(\d+(?:[.,]\d+)?)/gi)
  for (const match of money) {
    tokens.push((match[1] ?? '').replace(',', '.'))
  }
  const percents = text.matchAll(/(\d+(?:[.,]\d+)?)\s?(?:%|percent|peratus)/gi)
  for (const match of percents) {
    tokens.push(`${(match[1] ?? '').replace(',', '.')}%`)
  }
  return tokens
}

/** URL-ish tokens, so generated copy cannot invent links. */
function urlTokens(text: string): string[] {
  return [...text.matchAll(/(?:https?:\/\/|www\.)\S+/gi)].map((match) =>
    match[0].toLowerCase().replace(/[.,;!?)]+$/, ''),
  )
}

/**
 * True when every money, percentage and URL token in `text` already appears
 * in the grounding corpus. Fields that fail are refused whole — a poster
 * with a made-up price is worse than a poster with no price.
 */
export function isGrounded(text: string, corpus: string): boolean {
  const allowedMoney = new Set(moneyTokens(corpus))
  const allowedUrls = new Set(urlTokens(corpus))
  return (
    moneyTokens(text).every((token) => allowedMoney.has(token)) &&
    urlTokens(text).every((token) => allowedUrls.has(token))
  )
}

/* --- validation --------------------------------------------------------- */

/**
 * The copy call's response, validated field by field against the grounding
 * corpus. A field with an unsupported price, percentage or URL becomes null —
 * the deterministic draft (built purely from campaign facts) fills the gap.
 */
export function validateCreativeCopy(raw: unknown, corpus: string): CreativeCopyDraft {
  if (!isRecord(raw)) throw new CreativeValidationError('copy response was not an object')

  const grounded = (value: unknown, max: number): string | null => {
    const clean = text(value, max)
    if (!clean) return null
    return isGrounded(clean, corpus) ? clean : null
  }

  return {
    name: grounded(raw.name, LIMITS.name),
    headline: grounded(raw.headline, LIMITS.headline),
    subheadline: grounded(raw.subheadline, LIMITS.subheadline),
    callToAction: grounded(raw.callToAction, LIMITS.callToAction),
    offerText: grounded(raw.offerText, LIMITS.offerText),
    facebookCaption: grounded(raw.facebookCaption, LIMITS.facebookCaption),
    instagramCaption: grounded(raw.instagramCaption, LIMITS.instagramCaption),
    shortCopy: grounded(raw.shortCopy, LIMITS.shortCopy),
    whatsappCopy: grounded(raw.whatsappCopy, LIMITS.whatsappCopy),
    // The brief feeds an image prompt, so money is irrelevant, but it is
    // still clamped and stripped of URLs like everything else.
    imageBrief: grounded(raw.imageBrief, LIMITS.imageBrief),
    altText: text(raw.altText, LIMITS.altText),
  }
}

/**
 * A conversational edit. Null fields are untouched; anything present is
 * validated, clamped and grounded. The corpus for an edit includes the
 * owner's instruction — a price the owner types is the owner's to claim.
 */
export function validateCreativeEdit(raw: unknown, corpus: string): CreativeEditDraft {
  if (!isRecord(raw)) throw new CreativeValidationError('edit response was not an object')

  const patch: CreativePatch = {}
  const consider = (field: CreativeEditableField, value: unknown, max: number): void => {
    const clean = text(value, max)
    if (clean && isGrounded(clean, corpus)) patch[field] = clean
  }

  consider('name', raw.name, LIMITS.name)
  consider('headline', raw.headline, LIMITS.headline)
  consider('subheadline', raw.subheadline, LIMITS.subheadline)
  consider('body', raw.body, LIMITS.body)
  consider('callToAction', raw.callToAction, LIMITS.callToAction)
  consider('offerText', raw.offerText, LIMITS.offerText)
  consider('facebookCaption', raw.facebookCaption, LIMITS.facebookCaption)
  consider('instagramCaption', raw.instagramCaption, LIMITS.instagramCaption)
  consider('shortCopy', raw.shortCopy, LIMITS.shortCopy)
  consider('whatsappCopy', raw.whatsappCopy, LIMITS.whatsappCopy)

  return {
    reply: text(raw.reply, LIMITS.reply),
    patch,
    visualChange: text(raw.visualChange, LIMITS.imageBrief),
  }
}

export function readFormat(value: unknown): CreativeFormat {
  return value === 'portrait_post' ? 'portrait_post' : 'square_post'
}

/* --- coercion helpers (same posture as the campaign validator) ----------- */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const clean = value.replace(/\s+/g, ' ').trim()
  if (!clean) return null
  if (/^(unknown|n\/?a|none|not (found|stated|available|specified))$/i.test(clean)) return null
  return clean.length > max ? `${clean.slice(0, max).trimEnd()}…` : clean
}
