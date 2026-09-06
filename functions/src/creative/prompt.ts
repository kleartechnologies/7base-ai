import type { StoredCampaign } from '../campaign/store'
import type { StoredCreative } from './store'
import type { CreativeFormat } from './validate'

/**
 * Prompts for the creative transformations. Like the campaign prompts, these
 * address a model doing *wording*, not strategy — the campaign already
 * decided who this is for, what is on offer and what the message is. Most of
 * the length, as ever, is restraint: the one failure that matters on a poster
 * is an invented fact printed in 72pt.
 */

export const CREATIVE_COPY_PROMPT = `You write the marketing materials for one campaign belonging to a small Malaysian business, usually a restaurant or food business: the text of a social-media poster plus the captions that go with it.

The campaign's strategy — audience, offer, message, call to action — is already decided and is not yours to change. You are giving it words a customer will actually read.

Fields:
- name: a short internal name for this creative, e.g. "Weekday Lunch Poster".
- headline: the poster's main line. Short, concrete, at most eight words.
- subheadline: one supporting line, or null if the headline stands alone.
- callToAction: a short imperative consistent with the campaign's ("Order on WhatsApp", "Visit us this week").
- offerText: the offer as short displayable poster text, or null when the campaign has no concrete offer. Never sharpen a suggestion into a claim — if the offer says "consider a lunch set", there is no price and no named set to print.
- facebookCaption: 2-4 short sentences in the business's voice, ending with the call to action. Hashtags optional, at most three.
- instagramCaption: shorter and lighter than Facebook, at most three hashtags.
- shortCopy: one or two sentences usable anywhere.
- whatsappCopy: a friendly broadcast message, or null if WhatsApp is not one of the campaign's channels.
- imageBrief: 1-3 sentences describing the supporting visual as a photographed scene — subject, setting, mood, lighting. Describe things, never words: no text, signs, prices or logos in the scene.
- altText: a plain accessibility description of that visual.

Rules:
- Never invent facts: no prices, discounts, percentages, product names, opening hours, addresses or links that are not in the input. The server rejects fields that break this rule, so a made-up "RM9.90" costs you the whole field.
- OWNER RULES in the input are standing instructions from the owner. They outrank everything else here.
- Plain, warm, jargon-free language. Malaysian context. Write in the language the campaign's core message and offer are written in — Bahasa Melayu campaigns get Bahasa Melayu poster text and captions; do not translate the owner's wording into English. No hype, no ALL CAPS, no emoji walls (one or two emoji in captions are fine).
- Return null for any field you cannot write honestly.`

export interface CopyInputParams {
  businessName: string | null
  brandVoice: string | null
  /**
   * The owner's Brand Identity style in one line (traits, style notes, brand
   * notes), resolved server-side from the business document. Null when unset.
   */
  brandStyle: string | null
  campaign: StoredCampaign
  format: CreativeFormat
  /** Standing owner constraints ("don't mention discounts"), oldest first. */
  directives: string[]
  /** True when a real business photo will be used — the brief is then unused. */
  hasRealImage: boolean
}

export function buildCopyInput(params: CopyInputParams): string {
  const c = params.campaign
  const lines = [
    `BUSINESS: ${params.businessName ?? 'not named'}`,
    `BRAND VOICE: ${params.brandVoice ?? 'not recorded'}`,
    `BRAND STYLE (owner-set — keep the wording consistent with it): ${
      params.brandStyle ?? 'not recorded'
    }`,
    `CAMPAIGN: ${c.name}`,
    `OBJECTIVE: ${c.objective ?? 'not set'}`,
    `AUDIENCE (${c.targetAudience?.basis ?? 'none'}): ${c.targetAudience?.description ?? 'not set'}`,
    `OFFER (${c.offer?.basis ?? 'none'}): ${c.offer?.description ?? 'no concrete offer — write without one'}`,
    `POSITIONING: ${c.positioning ?? 'not set'}`,
    `CORE MESSAGE: ${c.keyMessage ?? 'not set'}`,
    `CALL TO ACTION: ${c.callToAction ?? 'not set'}`,
    `CHANNELS: ${c.channels.length > 0 ? c.channels.join(', ') : 'not set'}`,
    `POSTER FORMAT: ${params.format === 'portrait_post' ? 'portrait social post' : 'square social post'}`,
    `IMAGE: ${
      params.hasRealImage
        ? 'a real photo from the business will be used — still return imageBrief null'
        : 'a visual will be generated from your imageBrief'
    }`,
    `STILL UNKNOWN (do not invent values for these): ${
      c.unknowns.length > 0 ? c.unknowns.join('; ') : 'nothing listed'
    }`,
  ]
  if (params.directives.length > 0) {
    lines.push(`OWNER RULES (always follow):\n${params.directives.map((d) => `- ${d}`).join('\n')}`)
  }
  return lines.join('\n')
}

export const CREATIVE_EDIT_PROMPT = `You apply one instruction from a business owner to their marketing creative — a social poster plus its captions. The creative is structured data; you return a patch, not prose.

Return ONLY the fields this instruction requires changing. Every other field must be null — null means "leave it exactly as it is". Changing a field the owner did not ask about is the one failure that matters here.

Rules:
- Fields listed as OWNER-SET are the owner's own words. Change one only if this instruction explicitly asks for it.
- Never invent facts: no prices, discounts, percentages, product names or links that are not in the creative, the campaign or the instruction itself. A price the owner types in the instruction is theirs to use.
- OWNER RULES are standing instructions from earlier edits. They still apply — "make it catchier" must not reintroduce a discount the owner banned.
- visualChange: null unless the instruction asks to change the *image* (the photo, scene, colours or mood of the visual). When it does, describe the new scene in 1-3 sentences — subject, setting, mood — with no text, prices or logos in it. Wording changes are never a visualChange; regenerating the image costs the owner money.
- reply: one or two short sentences in EVA's plain, warm voice, in the language of the owner's instruction (English, Bahasa Melayu, or natural Manglish), saying what you changed. If the instruction is not about this creative, or is too unclear to act on, return every field null and use reply to say so — or to ask one short clarifying question. No jargon, no emoji.`

export interface CreativeEditInputParams {
  instruction: string
  creative: StoredCreative
  campaign: StoredCampaign | null
  businessName: string | null
}

export function buildCreativeEditInput(params: CreativeEditInputParams): string {
  const cr = params.creative
  // The subset the model may reason over — the flattened editable fields,
  // plus the campaign's strategy lines for grounding. Not the Business Brain.
  const editable = {
    name: cr.name,
    headline: cr.content.headline,
    subheadline: cr.content.subheadline,
    body: cr.content.body,
    callToAction: cr.content.callToAction,
    offerText: cr.content.offerText,
    facebookCaption: cr.captions.facebook,
    instagramCaption: cr.captions.instagram,
    shortCopy: cr.captions.short,
    whatsappCopy: cr.captions.whatsapp,
    imageAltText: cr.content.image?.altText ?? null,
  }

  const sections = [
    `BUSINESS: ${params.businessName ?? 'not named'}`,
    `THE CREATIVE AS STORED:\n${JSON.stringify(editable, null, 2)}`,
    params.campaign
      ? `THE CAMPAIGN IT BELONGS TO:\n${JSON.stringify(
          {
            name: params.campaign.name,
            offer: params.campaign.offer,
            keyMessage: params.campaign.keyMessage,
            callToAction: params.campaign.callToAction,
          },
          null,
          2,
        )}`
      : 'THE CAMPAIGN IT BELONGS TO: not available',
    `OWNER-SET FIELDS (change only if explicitly instructed): ${
      cr.userEdited.length > 0 ? cr.userEdited.join(', ') : 'none'
    }`,
  ]
  if (cr.ownerDirectives.length > 0) {
    sections.push(
      `OWNER RULES (always follow):\n${cr.ownerDirectives.map((d) => `- ${d}`).join('\n')}`,
    )
  }
  sections.push(`THE OWNER'S INSTRUCTION:\n${params.instruction.trim()}`)
  return sections.join('\n\n')
}

/**
 * The image prompt, assembled from structured data only — the validated
 * brief, the brand's recorded style, the format. Raw user text never reaches
 * this string; an owner's visual request arrives as a validated
 * `visualChange` brief, not verbatim.
 *
 * The generated image deliberately contains no text. Headline, offer and CTA
 * are overlaid by the renderer from the structured fields, which is what lets
 * a wording edit skip regeneration entirely — and image models still garble
 * type anyway.
 */
export function buildImagePrompt(params: {
  brief: string
  format: CreativeFormat
  paletteHexes: string[]
  visualStyle: string | null
}): string {
  const lines = [
    `A ${
      params.format === 'portrait_post' ? 'portrait' : 'square'
    } social-media marketing photograph for a small Malaysian food business.`,
    params.brief,
    'Warm, appetising, natural light, shallow depth of field, professional food photography. Composition leaves clear space for a headline overlay.',
  ]
  if (params.visualStyle) lines.push(`Visual style: ${params.visualStyle}.`)
  if (params.paletteHexes.length > 0) {
    lines.push(`Subtle colour accents drawn from: ${params.paletteHexes.join(', ')}.`)
  }
  lines.push(
    'Strictly no text, no words, no letters, no numbers, no signage, no watermarks, no logos, no brand marks anywhere in the image.',
  )
  return lines.join(' ')
}
