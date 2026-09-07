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
  /**
   * The owner's real app screenshot, composited onto the device in the
   * generated scene at render time. Only ever set alongside `image` — a
   * screen with no scene to stand in has nothing to be drawn onto.
   */
  deviceImage?: CreativeImage | null
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

/**
 * The creative direction EVA chose for a poster (Phase 7G) — deterministic,
 * from the campaign's intent and the assets on hand, never a classifier.
 * Drives the art-direction brief server-side and the layout client-side.
 */
export type CreativeDirection =
  | 'hero_product'
  | 'clean_editorial'
  | 'bold_promotional'
  | 'lifestyle'
  | 'educational'
  | 'app_showcase'
  | 'minimal_premium'
  | 'feature_highlight'

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
  /** The creative direction the poster was made in. Absent before Phase 7G. */
  direction?: CreativeDirection | null
  /**
   * How the poster is composed. Server-set at generation time, in the same
   * decision that briefed the image — so the renderer lays type into the room
   * the photograph was actually asked to leave. Absent before Phase 7G.1, and
   * the renderer then derives a composition from `direction` instead.
   */
  artDirection?: CreativeArtDirection | null
}

/**
 * The art direction a poster was generated under (Phase 7G.1).
 *
 * Deterministic and server-side: the image brief and the client layout are two
 * halves of one decision, so they cannot drift apart into a photograph shot
 * for one arrangement being typeset for another.
 */
export interface CreativeArtDirection {
  composition: PosterComposition
  accent: PosterAccentTreatment
  cta: PosterCtaStyle
  /** Whether a device layer is expected in the scene. */
  device: boolean
}

export type PosterComposition =
  | 'full_bleed'
  | 'hero_right'
  | 'hero_left'
  | 'center_hero'
  | 'editorial_split'
  | 'bottom_band'
  | 'card_overlay'
  | 'device_beside'
  | 'device_hero'
  | 'device_stack'
  | 'typographic'

export type PosterAccentTreatment = 'emphasis_word' | 'rule' | 'field' | 'chip'

export type PosterCtaStyle = 'solid' | 'outline' | 'chip' | 'bar'

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
