import type { StoredCampaign } from './store'

/**
 * Prompts for the two campaign transformations. Both address a model doing
 * *formatting and application*, not strategy — the strategic judgement was
 * already made (and paid for) on the reasoning tier when the recommendation
 * was produced. Most of the length, as ever, is restraint.
 */

export const CAMPAIGN_POLISH_PROMPT = `You turn one of EVA's marketing recommendations into the copy fields of a campaign draft for a small Malaysian business, usually a restaurant or food business.

You are naming and phrasing, not strategising. The strategy — audience, offer, channels, duration — is already decided and is not yours to change. You return exactly five fields:

- name: a short, specific campaign name, at most six words, plain words, no punctuation gimmicks. e.g. "Weekday Lunch Push", not "🚀 Ultimate Growth Campaign!!".
- objective: one sentence stating what the campaign is trying to achieve, in business terms.
- keyMessage: one short customer-facing line carrying the campaign's core message.
- callToAction: a short imperative ("Order on WhatsApp", "Book a table"), or null if none fits.
- notes: null, unless something operational genuinely needs flagging to the owner.

Rules:
- Never invent facts: no prices, discounts, percentages, product names, opening hours or claims that are not in the input. If the input's core message mentions no price, yours must not either.
- If the input's core message or call to action already reads well, return it unchanged — do not rewrite for its own sake. Return null for any field where the draft needs nothing from you.
- Plain, warm, jargon-free language. No hype, no emoji. Malaysian context.
- Write the fields in the language the input's core message and goal are written in — Bahasa Melayu input gets Bahasa Melayu copy; do not translate the owner's wording into English.`

export interface PolishInputParams {
  businessName: string | null
  goal: string
  opportunityTitle: string
  opportunityDescription: string
  diagnosis: string
  campaign: {
    targetAudience: { description: string; basis: string } | null
    offer: { description: string; basis: string } | null
    positioning: string | null
    keyMessage: string | null
    callToAction: string | null
    channels: string[]
    durationDays: number | null
    unknowns: string[]
  }
}

export function buildPolishInput(params: PolishInputParams): string {
  const c = params.campaign
  const lines = [
    `BUSINESS: ${params.businessName ?? 'not named'}`,
    `THE OWNER'S GOAL: ${params.goal}`,
    `RECOMMENDED FOCUS: ${params.opportunityTitle} — ${params.opportunityDescription}`,
    `DIAGNOSIS: ${params.diagnosis}`,
    `AUDIENCE (${c.targetAudience?.basis ?? 'none'}): ${c.targetAudience?.description ?? 'not set'}`,
    `OFFER (${c.offer?.basis ?? 'none'}): ${c.offer?.description ?? 'not set'}`,
    `POSITIONING: ${c.positioning ?? 'not set'}`,
    `CURRENT CORE MESSAGE: ${c.keyMessage ?? 'not set'}`,
    `CURRENT CALL TO ACTION: ${c.callToAction ?? 'not set'}`,
    `CHANNELS: ${c.channels.length > 0 ? c.channels.join(', ') : 'not set'}`,
    `DURATION: ${c.durationDays ? `${c.durationDays} days` : 'not set'}`,
    `STILL UNKNOWN (do not invent values for these): ${
      c.unknowns.length > 0 ? c.unknowns.join('; ') : 'nothing listed'
    }`,
  ]
  return lines.join('\n')
}

export const CAMPAIGN_EDIT_PROMPT = `You apply one instruction from a business owner to their marketing campaign. The campaign is structured data; you return a patch, not prose.

Return ONLY the fields this instruction requires changing. Every other field must be null — null means "leave it exactly as it is". Changing a field the owner did not ask about is the one failure that matters here.

Rules:
- Fields listed as OWNER-SET are the owner's own decisions. Change one only if this instruction explicitly asks for it.
- Never invent facts: no prices, discounts, sales numbers, best sellers, budgets or product claims that are not in the campaign or the instruction. If honouring the instruction would need a fact you do not have (e.g. a price), phrase the field without it and mention in the reply what the owner should confirm.
- targetAudience.basis and offer.basis: repeat the stored basis if you are keeping the description; anything you newly write is 'hypothesis' / 'recommendation'. The server enforces this anyway.
- channels may only contain: facebook, instagram, whatsapp, tiktok, in_store, website. durationDays is 1 to 90.
- reply: one or two short sentences in EVA's plain, warm voice, in the language of the owner's instruction (English, Bahasa Melayu, or natural Manglish), saying what you changed. If the instruction is not actually about this campaign, or is too unclear to act on, return every field null and use reply to say so — or to ask one short clarifying question. No jargon, no emoji.`

export interface EditInputParams {
  instruction: string
  campaign: StoredCampaign
  businessName: string | null
}

export function buildEditInput(params: EditInputParams): string {
  const c = params.campaign
  // The subset the model may reason over — not the whole document, and not
  // the Business Brain: an edit needs the campaign and the instruction.
  const editable = {
    name: c.name,
    objective: c.objective,
    targetAudience: c.targetAudience,
    offer: c.offer,
    positioning: c.positioning,
    keyMessage: c.keyMessage,
    callToAction: c.callToAction,
    channels: c.channels,
    durationDays: c.durationDays,
    notes: c.notes,
    assumptions: c.assumptions,
    unknowns: c.unknowns,
  }

  return [
    `BUSINESS: ${params.businessName ?? 'not named'}`,
    `THE CAMPAIGN AS STORED:\n${JSON.stringify(editable, null, 2)}`,
    `OWNER-SET FIELDS (change only if explicitly instructed): ${
      c.userEdited.length > 0 ? c.userEdited.join(', ') : 'none'
    }`,
    `THE OWNER'S INSTRUCTION:\n${params.instruction.trim()}`,
  ].join('\n\n')
}
