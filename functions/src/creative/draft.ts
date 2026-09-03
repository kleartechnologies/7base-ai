import type { StoredCampaign } from '../campaign/store'
import type { StoredBusiness } from '../lib/business.types'
import {
  CREATIVE_LIMITS,
  text,
  type CreativeCaptions,
  type CreativeContent,
  type CreativeCopyDraft,
} from './validate'

/**
 * Campaign → creative copy, deterministically.
 *
 * Same architecture as campaign building: the model call is an improvement,
 * not a dependency. This draft is assembled purely from campaign fields the
 * owner has already seen — key message, call to action, offer — so it can
 * never say anything the campaign does not, and creating marketing materials
 * never fails because a model was slow.
 */

export function draftCreativeCopyFromCampaign(campaign: StoredCampaign): {
  name: string
  content: Omit<CreativeContent, 'image' | 'layout'>
  captions: CreativeCaptions
} {
  const headline = clamp(campaign.keyMessage ?? campaign.name, CREATIVE_LIMITS.headline)
  const cta = clamp(campaign.callToAction, CREATIVE_LIMITS.callToAction)
  const offerText = clamp(campaign.offer?.description ?? null, CREATIVE_LIMITS.offerText)

  const sentence = [campaign.keyMessage, campaign.callToAction ? `${campaign.callToAction}.` : null]
    .filter(Boolean)
    .join(' ')
  const shortCopy = clamp(sentence || campaign.name, CREATIVE_LIMITS.shortCopy)

  return {
    name: clamp(`${campaign.name} Poster`, CREATIVE_LIMITS.name) ?? 'Campaign Poster',
    content: {
      headline,
      subheadline: null,
      body: null,
      callToAction: cta,
      offerText,
    },
    captions: {
      facebook: shortCopy,
      instagram: shortCopy,
      short: shortCopy,
      whatsapp: campaign.channels.includes('whatsapp') ? shortCopy : null,
    },
  }
}

/**
 * Folds the fast-tier copy into the deterministic draft. Null keeps the
 * draft's value; grounding was already enforced per field in
 * `validateCreativeCopy`, so a refused (ungrounded) field falls back to
 * campaign wording here rather than shipping an invented price.
 */
export function mergeCopy(
  fallback: ReturnType<typeof draftCreativeCopyFromCampaign>,
  copy: CreativeCopyDraft,
): ReturnType<typeof draftCreativeCopyFromCampaign> {
  return {
    name: copy.name ?? fallback.name,
    content: {
      headline: copy.headline ?? fallback.content.headline,
      subheadline: copy.subheadline ?? fallback.content.subheadline,
      body: fallback.content.body,
      callToAction: copy.callToAction ?? fallback.content.callToAction,
      offerText: copy.offerText ?? fallback.content.offerText,
    },
    captions: {
      facebook: copy.facebookCaption ?? fallback.captions.facebook,
      instagram: copy.instagramCaption ?? fallback.captions.instagram,
      short: copy.shortCopy ?? fallback.captions.short,
      whatsapp: copy.whatsappCopy ?? fallback.captions.whatsapp,
    },
  }
}

/**
 * Everything a creative's copy is allowed to claim: the campaign the owner
 * approved, the Business Brain's own products and prices, the business's
 * recorded contact surface — and, for edits, the owner's instruction itself.
 * A price or link that appears in none of these does not go on a poster.
 */
export function buildGroundingCorpus(params: {
  campaign: StoredCampaign
  business: StoredBusiness | null
  /** The owner's instruction, for edits — their own words are theirs to claim. */
  extra?: string[]
}): string {
  const { campaign, business } = params
  const parts: (string | null | undefined)[] = [
    campaign.name,
    campaign.objective,
    campaign.targetAudience?.description,
    campaign.offer?.description,
    campaign.positioning,
    campaign.keyMessage,
    campaign.callToAction,
    campaign.notes,
    ...campaign.assumptions,
    ...campaign.unknowns,
  ]

  if (business) {
    parts.push(business.name, business.contact.website, business.contact.whatsapp)
    for (const product of business.products) {
      parts.push(product.name, product.description)
      if (product.priceMinor !== null) {
        // Prices are stored in sen; the corpus needs them as printed: RM12.90.
        parts.push(`RM${(product.priceMinor / 100).toFixed(2)}`)
      }
    }
    const marketing = business.marketing?.value
    if (marketing) parts.push(...marketing.promotions, ...marketing.callsToAction)
  }

  parts.push(...(params.extra ?? []))
  return parts.filter(Boolean).join('\n')
}

/**
 * The corpus for a conversational edit adds two sources the initial one does
 * not have: the creative's own current copy (a price already on the poster
 * stays claimable when rewording around it) and the owner's instruction (a
 * price the owner types is theirs to use).
 */
export function buildCreativeEditCorpus(params: {
  creative: {
    name: string
    content: Omit<CreativeContent, 'image' | 'layout'> & Partial<CreativeContent>
    captions: CreativeCaptions
    ownerDirectives: string[]
  }
  campaign: StoredCampaign | null
  business: StoredBusiness | null
  instruction: string
}): string {
  const { creative } = params
  const own = [
    creative.name,
    creative.content.headline,
    creative.content.subheadline,
    creative.content.body,
    creative.content.callToAction,
    creative.content.offerText,
    creative.captions.facebook,
    creative.captions.instagram,
    creative.captions.short,
    creative.captions.whatsapp,
    ...creative.ownerDirectives,
    params.instruction,
  ].filter(Boolean) as string[]

  if (params.campaign) {
    return buildGroundingCorpus({
      campaign: params.campaign,
      business: params.business,
      extra: own,
    })
  }
  return own.join('\n')
}

function clamp(value: string | null, max: number): string | null {
  return text(value, max)
}
