import type { StoredCampaign } from '../campaign/store'
import type { CreativeDirection } from './direction'
import { POSTER_COPY_LIMITS } from './posterCopy'
import type { StoredCreative } from './store'
import type { CreativeFormat } from './validate'

/**
 * Prompts for the creative transformations. Like the campaign prompts, these
 * address a model doing *wording*, not strategy — the campaign already
 * decided who this is for, what is on offer and what the message is. Most of
 * the length, as ever, is restraint: the one failure that matters on a poster
 * is an invented fact printed in 72pt.
 */

export const CREATIVE_COPY_PROMPT = `You write the marketing materials for one campaign belonging to a small Malaysian business — a restaurant, a shop, a service, an app, a class, anything: the text of a social-media poster plus the captions that go with it.

The campaign's strategy — audience, offer, message, call to action — is already decided and is not yours to change. You are giving it words a customer will actually read.

A poster and a caption do different jobs, and mixing them is the mistake to avoid. The poster carries attention, one message and one action; it is read from a phone at arm's length, in about a second. The caption carries the explanation, the details, the link and the hashtags. Anything that needs a second sentence belongs in the caption.

Fields:
- name: a short internal name for this creative, e.g. "Weekday Lunch Poster".
- headline: the poster's main line. At most six words and ${POSTER_COPY_LIMITS.headline} characters. Concrete, human, no full stop. Not a sentence, not a summary of the campaign.
- subheadline: one short supporting line of about ten words, or null if the headline stands alone. Never a second paragraph.
- callToAction: the button. Two or three words, an action ("Order on WhatsApp", "Cuba Percuma", "Book a class"). Never a link, phone number, address or sentence — those go in the captions.
- offerText: the offer as short displayable poster text (at most ${POSTER_COPY_LIMITS.offerText} characters), or null when the campaign has no concrete offer. Never sharpen a suggestion into a claim — if the offer says "consider a lunch set", there is no price and no named set to print.
- facebookCaption: 2-4 short sentences in the business's voice, ending with the call to action. This is where a link belongs, if the campaign has one. Hashtags optional, at most three.
- instagramCaption: shorter and lighter than Facebook, at most three hashtags.
- shortCopy: one or two sentences usable anywhere.
- whatsappCopy: a friendly broadcast message, or null if WhatsApp is not one of the campaign's channels.
- imageBrief: 1-3 sentences describing the supporting visual — subject, setting, mood, lighting. Describe things, never words: no text, signs, prices or logos in the scene, because the poster's words are set over this image afterwards.
- altText: a plain accessibility description of that visual.

Rules:
- Never invent facts: no prices, discounts, percentages, product names, opening hours, addresses or links that are not in the input. The server rejects fields that break this rule, so a made-up "RM9.90" costs you the whole field.
- OWNER RULES in the input are standing instructions from the owner. They outrank everything else here.
- SET CONTEXT in the input, when present, places this poster in a set the owner asked for in one go, with the owner's request quoted. Give this poster its own angle within that request: when the request lists distinct concepts or languages, this poster takes the one at its position, in the language named for it; otherwise vary the angle from the other posters. The campaign's facts still bound every claim.
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
  /**
   * Phase 7F: this poster's place in a multi-poster chat request ("poster 2
   * of 3 … the owner asked: …"), built server-side by the chat action. Null
   * for the button path and single posters.
   */
  setContext?: string | null
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
  if (params.setContext) {
    lines.push(`SET CONTEXT: ${params.setContext}`)
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
 * The art-direction brief for the poster's visual.
 *
 * The image model is treated as a visual designer, not a stock-photo search:
 * the brief states the intent, the focal point, the composition, the
 * treatment and where the frame must stay quiet — and then leaves the model
 * free to design within it. What it must never do is *write*. Every word on
 * the finished poster (headline, offer, call to action) is set by the
 * renderer from the structured fields, and the logo is composited from the
 * owner's real file, because a generated logo is a forgery and generated
 * type is a garble. That division is also what lets a wording edit skip
 * regeneration entirely.
 *
 * The brief is assembled from structured data only — the validated visual
 * brief, the deterministic creative direction, the brand's recorded style,
 * the format. Raw user text never reaches this string; an owner's visual
 * request arrives as a validated `visualChange` brief, not verbatim.
 */

/**
 * What each creative direction asks the image to be, and where it must leave
 * room. `reserve` mirrors how `posterDesign.ts` lays that direction out on
 * the client — the two are a pair: a visual whose subject sits where the
 * headline goes is a visual fighting its own poster.
 */
const ART_DIRECTION: Record<CreativeDirection, { intent: string; reserve: string }> = {
  hero_product: {
    intent:
      'One hero shot of the product itself, styled like a premium product advertisement: the subject lit deliberately, materials and texture readable, a simple complementary background that flatters it. Real depth, soft directional light, a believable surface underneath.',
    reserve:
      'Centre the subject with even breathing room on all four sides and keep the outer tenth of the frame free of important detail.',
  },
  clean_editorial: {
    intent:
      'A modern editorial photograph with an advertising sensibility: one clear subject, an uncluttered environment, natural directional light, a restrained colour story. Magazine quality, not stock-library generic.',
    reserve:
      'Place the subject in the upper or right two-thirds, and let the lower-left quarter fall away into plain, evenly lit surface or soft shadow with nothing of interest in it.',
  },
  bold_promotional: {
    intent:
      'A high-energy advertising photograph with strong contrast and saturated, confident lighting — the kind of frame that stops a scroll. Bold, but composed: one subject, no clutter.',
    reserve:
      'Compose for the top half: the subject sits in the upper middle, and the bottom third of the photograph is plain, quiet surface with nothing of interest in it.',
  },
  lifestyle: {
    intent:
      'A candid lifestyle moment: real people or real hands using, enjoying or sharing the thing, in a believable Malaysian setting. Warm, natural, unposed, documentary light.',
    reserve:
      'Place the action in the upper or right two-thirds, and let the lower-left quarter fall away into plain, evenly lit surface or soft shadow with nothing of interest in it.',
  },
  educational: {
    intent:
      'A calm, credible image about learning and understanding: a focused person, a workspace, materials in use. Clean, bright, uncluttered, encouraging rather than clinical.',
    reserve:
      'Centre the subject with generous even space around it and a quiet, plain background.',
  },
  app_showcase: {
    intent:
      'A product-technology composition: a modern device or a clean abstract representation of the product on a simple studio ground, with soft graphic shapes and gentle depth. If a screen is visible, render it as abstract colour blocks and shapes only — never readable interface text, numbers or icons that spell words.',
    reserve:
      'Centre the composition with even margins and keep the outer tenth of the frame free of important detail.',
  },
  minimal_premium: {
    intent:
      'A quiet, premium still life: one subject, restrained palette, soft gradient light, a lot of empty space. Considered and expensive-looking, closer to a fashion or fragrance advertisement than a catalogue photo.',
    reserve:
      'Centre the subject small in the frame with generous, genuinely empty negative space around it.',
  },
  feature_highlight: {
    intent:
      'A clean arrangement of the things on offer: several related items or moments composed as one deliberate group on a simple ground, evenly lit, each readable.',
    reserve:
      'Keep the group centred with even margins and the outer tenth of the frame free of important detail.',
  },
}

/** The quality bar, stated once and applied to every direction. */
const QUALITY_BAR =
  'Advertising quality: one clear focal point, an intentional composition, real depth and directional light, strong separation between subject and background, deliberate negative space. Nothing flat, nothing clip-art, no collage, no busy backdrop, no template look, no borders or frames.'

const NO_TEXT_RULE =
  'Strictly no text of any kind: no words, letters, numbers, captions, labels, signage, packaging copy, watermarks, logos or brand marks anywhere in the image.'

/**
 * The model draws the *photograph*; the renderer lays the headline, the
 * colour panel and the real logo over it afterwards. Saying "a panel goes
 * here" invites the model to paint one — and then the poster carries two,
 * in two different colours. So the reserve lines above describe the picture
 * only, and this rule closes the door explicitly.
 */
const PHOTOGRAPH_ONLY_RULE =
  'This is a photograph, not a finished poster: no flat colour panels, bars, banners, ribbons, stickers, badges, buttons, price tags, speech bubbles, arrows or graphic overlays of any kind, and no empty boxes or placeholder shapes waiting to be filled.'

export function buildImagePrompt(params: {
  brief: string
  format: CreativeFormat
  direction: CreativeDirection
  paletteHexes: string[]
  visualStyle: string | null
  /** The owner's own words for what the business is. Null when unknown. */
  businessType: string | null
}): string {
  const art = ART_DIRECTION[params.direction]
  const shape = params.format === 'portrait_post' ? 'portrait 4:5' : 'square 1:1'
  const lines = [
    `A ${shape} advertising visual for a small Malaysian business${
      params.businessType ? ` — ${params.businessType}` : ''
    }.`,
    // The brief is one sentence in a paragraph of them; the deterministic
    // fallback brief (campaign fields joined together) often has no full stop.
    sentence(params.brief),
    art.intent,
    art.reserve,
    QUALITY_BAR,
  ]
  if (params.visualStyle) lines.push(`Visual style: ${params.visualStyle}.`)
  if (params.paletteHexes.length > 0) {
    lines.push(
      `Brand colours ${params.paletteHexes.join(', ')} appear as accents — a prop, a surface, a lighting cast or one graphic shape. Never flood the frame with them; most of the image stays neutral.`,
    )
  }
  lines.push(PHOTOGRAPH_ONLY_RULE, NO_TEXT_RULE)
  return lines.join(' ')
}

/** One sentence, ending like one. */
function sentence(value: string): string {
  const text = value.replace(/\s+/g, ' ').trim()
  if (!text) return text
  return /[.!?]$/.test(text) ? text : `${text}.`
}
