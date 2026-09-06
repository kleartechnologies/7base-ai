import type { EntityId, Millis, OwnedEntity } from './common'

/**
 * Creatives stay structured for as long as possible.
 *
 * A rendered PNG is an *output* of a creative, not the creative itself, so the
 * headline, offer and CTA remain editable and re-renderable after generation.
 */
export interface Creative extends OwnedEntity {
  businessId: EntityId
  campaignId: EntityId | null
  /** The conversation the creative was made in; null outside chat. */
  conversationId: EntityId | null
  /** Traceability: Creative → Campaign → Recommendation. Server-set. */
  sourceRecommendationId: EntityId | null
  name: string
  format: CreativeFormat
  status: CreativeStatus
  content: CreativeContent
  /** Channel copy that travels with the poster. */
  captions: CreativeCaptions
  style: CreativeStyle
  /**
   * Every business Asset this creative actually uses (snapshotted product
   * photo and/or logo). Server-set and frozen by rules; absent on creatives
   * made before the Assets integration.
   */
  assetIds?: EntityId[]
  /** Flattened export, produced from `content` + `style`. */
  render: CreativeRender | null
  /**
   * Copy fields the owner has taken authority over — by editing directly or
   * by instructing MARKA. An AI update never silently reverts one.
   */
  userEdited: CreativeEditableField[]
  /** Standing constraints from the owner ("don't mention discounts"). */
  ownerDirectives: string[]
  /** Safe, owner-facing sentence when the image could not be made. */
  imageError: string | null
}

export interface CreativeCaptions {
  facebook: string | null
  instagram: string | null
  short: string | null
  whatsapp: string | null
}

export type CreativeEditableField =
  | 'name'
  | 'headline'
  | 'subheadline'
  | 'body'
  | 'callToAction'
  | 'offerText'
  | 'facebookCaption'
  | 'instagramCaption'
  | 'shortCopy'
  | 'whatsappCopy'

export type CreativeFormat =
  | 'square_post'
  | 'portrait_post'
  | 'story'
  | 'poster'
  | 'banner'

export type CreativeStatus = 'draft' | 'generating' | 'ready' | 'failed'

export interface CreativeContent {
  headline: string | null
  subheadline: string | null
  body: string | null
  callToAction: string | null
  offerText: string | null
  /** Background or subject image. */
  image: CreativeImage | null
  layout: CreativeLayout
}

export interface CreativeImage {
  /** Storage path, not a signed URL — URLs expire, paths do not. */
  storagePath: string | null
  /** Present for AI-generated imagery. */
  prompt: string | null
  altText: string | null
  source: 'upload' | 'generated' | 'stock'
  /**
   * The business Asset an 'upload' image was snapshotted from. Server-set;
   * a generated image never carries one.
   */
  assetId?: EntityId
}

/** Named arrangements rather than free-form coordinates, so layouts stay sane. */
export type CreativeLayout =
  | 'image_top'
  | 'image_full_bleed'
  | 'text_only'
  | 'split'

export interface CreativeStyle {
  /** Falls back to the Business Brain's brand profile when null. */
  palette: string[] | null
  headingFont: string | null
  bodyFont: string | null
  logoStoragePath: string | null
  /**
   * The logo Asset `logoStoragePath` was snapshotted from. Server-set; the
   * logo is composited onto the poster client-side, never by the image model.
   */
  logoAssetId?: EntityId | null
  /**
   * Which parts of the owner's Brand Identity fed this creative. Server-set
   * at generation time; absent on creatives made before Phase 7D (the applied
   * panel simply does not render for those).
   */
  brandApplied?: BrandAppliedSummary | null
}

/** What the read-only "Brand Identity — applied" panel renders from. */
export interface BrandAppliedSummary {
  logo: boolean
  colors: boolean
  typography: boolean
  style: boolean
}

export interface CreativeRender {
  storagePath: string
  width: number
  height: number
  renderedAt: Millis
}
