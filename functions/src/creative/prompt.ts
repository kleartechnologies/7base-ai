import type { StoredCampaign } from '../campaign/store'
import { compositionBrief, type PosterComposition } from './artDirection'
import type { CreativeDirection } from './direction'
import { POSTER_COPY_LIMITS } from './posterCopy'
import type { StoredCreative } from './store'
import { CREATIVE_LIMITS as LIMITS, type CreativeFormat } from './validate'

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
- shortCopy: one or two sentences usable anywhere — the general caption, for a story, a flyer, a reply to a customer.
- whatsappCopy: a friendly broadcast message, or null if WhatsApp is not one of the campaign's channels.
- xCopy: one post for X. At most ${LIMITS.xCopy} characters including any hashtag, because the owner still has a link to paste. One thought, said straight, no wind-up and no thread. Usually no hashtag at all.
- tiktokCopy: one TikTok caption. It sounds like someone talking, opens on the hook — the thing that makes a person stop — and runs to about ${LIMITS.tiktokCopy} characters at most. Up to three hashtags, only ones a real person would use for this business.
- imageBrief: 1-3 sentences describing the supporting visual — who or what is in it, where, what they are doing, the light, and the feeling. Name a specific moment, not a category: "a hawker lifting a ladle out of the pot, steam catching the morning light" rather than "food at a stall". VISUAL DIRECTION in the input, when present, says what kind of picture this poster is; write the brief as that kind of picture. Describe things, never words: no text, signs, prices or logos in the scene, because the poster's words are set over this image afterwards.
- altText: a plain accessibility description of that visual.

Rules:
- Never invent facts: no prices, discounts, percentages, product names, opening hours, addresses or links that are not in the input. The server rejects fields that break this rule, so a made-up "RM9.90" costs you the whole field.
- OWNER RULES in the input are standing instructions from the owner. They outrank everything else here.
- ALREADY WRITTEN IN THIS SET lists the posters of this set that exist already, with their headline and the picture they use. Yours must not repeat them. A different message, said differently, over a genuinely different picture — another subject, another moment, another place, another distance. Rewording one of them is the failure this list exists to prevent.
- SET CONTEXT in the input, when present, places this poster in a set the owner asked for in one go, with the owner's request quoted. Give this poster its own angle within that request: when the request lists distinct concepts or languages, this poster takes the one at its position, in the language named for it; otherwise vary the angle from the other posters. This applies to the picture as much as the words — a set whose three imageBriefs describe the same person at the same table in the same light is one poster printed three times, which is a failure. Change the subject, the moment, the place or the distance. The campaign's facts still bound every claim.
- The captions are four different jobs, not one caption reworded four times. Facebook explains and can carry the link; Instagram is lighter and shorter; X is one blunt thought inside its character budget; TikTok opens on a hook and sounds spoken. If two of them could be swapped without anyone noticing, they are wrong. Hashtags belong where they are used — Instagram and TikTok — not forced into Facebook, X or WhatsApp.
- No filler that could belong to any business on earth. "Unlock your potential", "take your business to the next level", "don't miss out", "elevate your experience", "game-changer" and their Malay equivalents are banned unless the campaign's own words genuinely say that.
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
  /**
   * Phase 7G.2: the creative direction and composition already chosen for
   * this poster, so the image brief describes the same idea the renderer is
   * about to lay out — and, within a set, a different idea from its siblings.
   * The alternative is what the baseline did: three different compositions
   * over three copies of one photograph.
   */
  visual?: { direction: CreativeDirection; composition: PosterComposition } | null
  /**
   * Phase 7G.2: the posters of this set already written, oldest first. Each
   * copy call is its own request, so without this the model cannot know what
   * its siblings said and converges on the same answer — three posters of one
   * student at one desk, which is what the live run showed.
   */
  alreadyInSet?: readonly { headline: string | null; imageBrief: string | null }[]
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
  if (params.visual && !params.hasRealImage) {
    const shape = compositionBrief(params.visual.composition)
    lines.push(
      `VISUAL DIRECTION (the kind of picture this poster is — write imageBrief as this): ${
        SUBJECT_DIRECTION[params.visual.direction]
      }`,
      `COPY SPACE (where this poster's words will sit over that picture): ${shape.quiet}`,
    )
  }
  const already = params.alreadyInSet ?? []
  if (already.length > 0) {
    lines.push(
      `ALREADY WRITTEN IN THIS SET (do not repeat or reword these):\n${already
        .map((poster, index) => {
          const picture = poster.imageBrief ? ` — its picture: ${poster.imageBrief}` : ''
          return `${index + 1}. "${poster.headline ?? 'untitled'}"${picture}`
        })
        .join('\n')}`,
    )
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
    xCopy: cr.captions.x ?? null,
    tiktokCopy: cr.captions.tiktok ?? null,
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
 * The image model is briefed as a photographer on an advertising shoot, not
 * as a stock-photo search: the brief names the subject, the light, the lens,
 * the mood and the composition, and then leaves the model to make the
 * picture. What it must never do is *write*. Every word on the finished
 * poster (headline, offer, call to action) is set by the renderer from the
 * structured fields, and the logo is composited from the owner's real file,
 * because a generated logo is a forgery and generated type is a garble. That
 * division is also what lets a wording edit skip regeneration entirely.
 *
 * The brief is assembled from structured data only — the validated visual
 * brief, the deterministic creative direction and art direction, the brand's
 * recorded style, the format. Raw user text never reaches this string; an
 * owner's visual request arrives as a validated `visualChange` brief.
 */

/**
 * The register the whole brief is written in.
 *
 * The previous version of this asked for the absence of things — nothing
 * flat, nothing clip-art, no template look — and got exactly what a negative
 * brief gets: a frame with nothing wrong with it and nothing in it. Muted
 * light, a beige wall, a subject standing still. So the quality bar now
 * states what the photograph *is*, and the model has something to aim at
 * rather than something to avoid.
 */
const QUALITY_BAR = [
  'Photograph this as a commercial advertising campaign image, shot by a professional on a full-frame camera with a fast prime lens.',
  'Bright, confident, directional light with real modelling — a clear key, visible falloff, and highlights that lift the subject off the background.',
  'Rich, true colour and deep contrast: clean whites, real blacks, natural skin tones, materials that read as themselves. Not muted, not washed out, not beige.',
  'Shallow depth of field with a decisive focal point, so the eye lands in one place and the rest of the frame recedes.',
  'If people appear they are believable and present — natural expression, genuine attention on what they are doing, never a posed stock-photo smile at the camera.',
].join(' ')

/** What each creative direction is a photograph *of*. */
const SUBJECT_DIRECTION: Record<CreativeDirection, string> = {
  hero_product:
    'The product itself is the hero, styled and lit the way a premium brand photographs the thing it sells.',
  clean_editorial:
    'One clear subject in an uncluttered contemporary setting, in the register of a magazine feature rather than a catalogue.',
  bold_promotional:
    'A high-energy frame with strong contrast and saturated colour — the kind of picture that stops a scroll.',
  lifestyle:
    'A candid, unposed moment: real people or real hands using, enjoying or sharing the thing, in a believable Malaysian setting.',
  educational:
    'A focused person and the materials of learning in use — bright, encouraging and credible rather than clinical.',
  app_showcase:
    'Software in real use: a person and a phone in a real place, photographed as a moment rather than as a device catalogue shot.',
  minimal_premium:
    'A quiet, expensive still life — one subject, restrained palette, a great deal of considered space.',
  feature_highlight:
    'Several related items or moments composed as one deliberate group, each of them readable.',
}

const NO_TEXT_RULE =
  'Strictly no text of any kind: no words, letters, numbers, captions, labels, signage, packaging copy, watermarks, logos or brand marks anywhere in the image.'

/**
 * The model draws the *photograph*; the renderer lays the headline, the
 * brand colour and the real logo over it afterwards. Saying "a panel goes
 * here" invites the model to paint one — and then the poster carries two, in
 * two different colours. So the composition briefs describe the picture only,
 * and this rule closes the door explicitly.
 */
const PHOTOGRAPH_ONLY_RULE =
  'This is a photograph, not a finished poster: no flat colour panels, bars, banners, ribbons, stickers, badges, buttons, price tags, speech bubbles, arrows, borders, frames or graphic overlays of any kind, and no empty boxes or placeholder shapes waiting to be filled.'

export function buildImagePrompt(params: {
  brief: string
  format: CreativeFormat
  direction: CreativeDirection
  /**
   * Where the subject must sit and where the frame must stay quiet, so the
   * photograph is generated for the layout the renderer will actually use.
   */
  composition: PosterComposition
  paletteHexes: string[]
  visualStyle: string | null
  /** The owner's own words for what the business is. Null when unknown. */
  businessType: string | null
}): string {
  const shape = params.format === 'portrait_post' ? 'portrait 4:5' : 'square 1:1'
  const brief = compositionBrief(params.composition)
  const lines = [
    `A ${shape} advertising photograph for a small Malaysian business${
      params.businessType ? ` — ${params.businessType}` : ''
    }.`,
    // The brief is one sentence in a paragraph of them; the deterministic
    // fallback brief (campaign fields joined together) often has no full stop.
    sentence(params.brief),
    SUBJECT_DIRECTION[params.direction],
    brief.subject,
    brief.quiet,
    QUALITY_BAR,
  ]
  if (params.visualStyle) lines.push(`Brand character: ${params.visualStyle}.`)
  if (params.paletteHexes.length > 0) {
    // Colour that belongs to the scene reads as art direction; colour poured
    // over it reads as a filter. So the brand hue arrives as things that are
    // genuinely that colour, and most of the frame stays neutral.
    lines.push(
      `Work the brand colours ${params.paletteHexes.join(', ')} into the scene as real things that happen to be that colour — a garment, a prop, a painted surface, a plant, a reflected light — so the frame feels connected to the brand. Keep them to accents; most of the image stays neutral, and never apply them as a wash, tint or filter over the whole picture.`,
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
