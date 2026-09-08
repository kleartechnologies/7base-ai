import { buildCampaignCardBlock } from '../../campaign/present'
import type { StoredCampaign } from '../../campaign/store'
import { buildCreativePresentation, FALLBACK_COPY_NOTE } from '../../creative/present'
import type { StoredCreative } from '../../creative/store'
import type {
  ActionProposalBlock,
  CreativeRequestSpec,
  CreativeSetBlock,
  CreativeSetItem,
  MessageBlock,
  ProposedAction,
} from '../../lib/types'

/**
 * Phase 7F — how an action reads in the thread. Every sentence here is
 * deterministic, in EVA's voice, in the language the owner is using, and
 * says only what actually happened: created means persisted, "couldn't be
 * completed" means exactly that. Nothing about models, tasks, cost or quota
 * mechanics ever appears — a daily limit is stated in the guardrail's own
 * owner-facing sentence and nothing more.
 */

export type ReplyLanguage = 'en' | 'ms'

export interface Presentation {
  blocks: MessageBlock[]
  plainText: string
}

/* --- language ---------------------------------------------------------------- */

/**
 * Which language the deterministic sentences use: the owner's saved app
 * language, unless the message they just typed is plainly the other one.
 * A heuristic on a handful of unmistakable words — not a classifier.
 */
export function detectReplyLanguage(text: string, preferred: ReplyLanguage): ReplyLanguage {
  const lower = text.toLowerCase()
  const malay =
    /\b(?:saya|kami|kita|nak|mahu|buat|buatkan|boleh|tolong|kempen|teruskan|jom|sila|untuk|dengan|poster ni|poster tu|ya boleh|setuju|bikin|sediakan)\b/.test(
      lower,
    )
  const english =
    /\b(?:please|create|make|design|the|yes|go ahead|okay|ok|posters?|campaign|for|with|them|it)\b/.test(
      lower,
    )
  if (malay && !english) return 'ms'
  if (english && !malay) return 'en'
  return preferred
}

/* --- pluralisation helpers --------------------------------------------------- */

function posters(count: number, language: ReplyLanguage): string {
  if (language === 'ms') return `${count} poster`
  return count === 1 ? '1 poster' : `${count} posters`
}

const ORDINAL_EN = ['first', 'second', 'third', 'fourth', 'fifth']
const ORDINAL_MS = ['pertama', 'kedua', 'ketiga', 'keempat', 'kelima']

function ordinal(position: number, language: ReplyLanguage): string {
  const table = language === 'ms' ? ORDINAL_MS : ORDINAL_EN
  return table[position - 1] ?? `#${position}`
}

/* --- proposal blocks --------------------------------------------------------- */

export function confirmLabelFor(action: ProposedAction, language: ReplyLanguage): string {
  switch (action.kind) {
    // Phase 7G §10/§11 — the button says the doing, not "yes". The summary
    // line right above it already carries what and where.
    case 'creative.generate': {
      const count = action.spec.positions.length
      if (language === 'ms') return count === 1 ? 'Buat poster' : `Buat ${count} poster`
      return count === 1 ? 'Make the poster' : `Make ${count} posters`
    }
    // A campaign built from a recommendation is the same promise to the
    // owner as a campaign created from scratch: they never learn which
    // internal pipeline made it.
    case 'campaign.create':
    case 'campaign.build':
      return language === 'ms' ? 'Buat kempen' : 'Create the campaign'
    case 'campaign.choose':
      // The choices themselves are the buttons.
      return ''
  }
}

/** The button on a retry of part of a set: "Try the third one again". */
export function retryLabelFor(positions: number[], language: ReplyLanguage): string {
  if (positions.length === 1) {
    const position = positions[0] ?? 1
    return language === 'ms'
      ? `Cuba yang ${ordinal(position, 'ms')} sekali lagi`
      : `Try the ${ordinal(position, 'en')} one again`
  }
  return language === 'ms' ? 'Cuba yang tinggal sekali lagi' : 'Try the missing ones again'
}

/**
 * The whole plan in one line: what gets made, where it is for, what shape it
 * is. This is the *only* confirmation an owner should ever need to read —
 * no campaign mechanics, no format codes, no options to configure. Null when
 * the proposal is a choice between campaigns, where the buttons say it.
 */
export function proposalSummary(
  action: ProposedAction,
  language: ReplyLanguage,
): string | null {
  const spec =
    action.kind === 'creative.generate'
      ? action.spec
      : action.kind === 'campaign.create' || action.kind === 'campaign.build'
        ? action.then
        : null
  if (!spec) return null
  const ms = language === 'ms'
  const shape =
    spec.format === 'portrait_post' ? (ms ? 'Menegak' : 'Portrait') : ms ? 'Segi empat' : 'Square'
  return [posters(spec.positions.length, language), 'Instagram & Facebook', shape].join(' · ')
}

export function buildProposalBlock(
  id: string,
  action: ProposedAction,
  language: ReplyLanguage,
  confirmLabel: string = confirmLabelFor(action, language),
): ActionProposalBlock {
  return {
    id,
    type: 'action_proposal',
    action,
    confirmLabel,
    summary: proposalSummary(action, language),
  }
}

/** The proposal's own sentence, for the situations that need one. */
export function proposalLead(
  action: ProposedAction,
  language: ReplyLanguage,
  situation:
    | { kind: 'no_campaign' }
    | { kind: 'choose' }
    | { kind: 'quota_cap'; requested: number }
    | { kind: 'size_cap'; requested: number }
    | { kind: 'campaign_ready' }
    | { kind: 'repeat' }
    | { kind: 'offer_set' }
    | { kind: 'from_recommendation' }
    | { kind: 'reask' },
): string {
  const ms = language === 'ms'
  const count =
    action.kind === 'creative.generate'
      ? action.spec.positions.length
      : action.kind === 'campaign.build'
        ? (action.then?.positions.length ?? null)
        : null
  switch (situation.kind) {
    case 'no_campaign': {
      const then =
        action.kind === 'campaign.create' || action.kind === 'campaign.build' ? action.then : null
      const n = then ? then.positions.length : 0
      if (ms) {
        return n > 0
          ? `Anda belum ada kempen untuk ini. Saya boleh buatkan satu, kemudian sediakan ${posters(n, 'ms')}. Nak saya teruskan?`
          : 'Anda belum ada kempen untuk ini. Saya boleh buatkan satu. Nak saya teruskan?'
      }
      return n > 0
        ? `You don’t have a campaign for this yet. I can create one for you, then make the ${posters(n, 'en')}. Want me to go ahead?`
        : 'You don’t have a campaign for this yet. I can create one for you. Want me to go ahead?'
    }
    /*
      The campaign names are the buttons underneath (Phase 7J §8/§17), so
      the question asks once and stops. Listing them here as well said the
      same two names twice in four lines.
    */
    case 'choose':
      return ms
        ? 'Poster ini untuk kempen yang mana?'
        : 'Which campaign should these posters be for?'
    case 'reask':
      return ms ? 'Yang mana satu?' : 'Which one?'
    case 'quota_cap':
      return ms
        ? `Saya boleh buat ${count} daripada ${situation.requested} hari ini — had harian anda dah dicapai untuk selebihnya. Nak saya teruskan dengan ${count}?`
        : `I can create ${count} of the ${situation.requested} today — you’ve reached today’s limit for the rest. Want me to go ahead with ${count}?`
    case 'size_cap':
      return ms
        ? `Saya boleh buat sehingga ${count} poster sekali gus. Nak saya mulakan dengan ${count}?`
        : `I can create up to ${count} posters at a time. Want me to start with ${count}?`
    case 'campaign_ready':
      return ms
        ? `Kempen anda dah siap. Cakap “teruskan” dan saya akan buat ${posters(count ?? 1, 'ms')}.`
        : `Your campaign is ready. Say go and I’ll create the ${posters(count ?? 1, 'en')}.`
    case 'repeat':
      return ms
        ? 'Saya baru sahaja buat poster itu — ada di atas. Nak satu set lagi?'
        : 'I just created those — they’re above. Want another set?'
    // The owner asked for posters without saying how many. EVA answers with
    // a plan, not a form: one sentence, one summary line, one button.
    case 'offer_set':
      return ms
        ? `Boleh. Saya boleh buatkan ${posters(count ?? 1, 'ms')} untuk ini, setiap satu dengan gaya berbeza.`
        : `Sure. I can make you ${posters(count ?? 1, 'en')} for this, each with a different look.`
    // Phase 7J §7 — the owner said what they want to promote, not what they
    // want *built*. EVA names the outcome and hides the plumbing: one
    // sentence, one summary line, one button. The campaign document is
    // never mentioned as a thing they have to understand first.
    case 'from_recommendation':
      return count && count > 0
        ? ms
          ? `Saya boleh terus jadikan ini sebagai kempen dan sediakan ${posters(count, 'ms')} untuknya.`
          : `I can turn this into a campaign and make ${posters(count, 'en')} for it.`
        : ms
          ? 'Saya boleh terus jadikan ini sebagai kempen untuk anda.'
          : 'I can turn this into a campaign for you.'
  }
}

export function presentProposal(
  action: ProposedAction,
  language: ReplyLanguage,
  situation: Parameters<typeof proposalLead>[2],
): Presentation {
  const lead = proposalLead(action, language, situation)
  return {
    blocks: [
      { id: 'b0', type: 'text', text: lead },
      buildProposalBlock('b1', action, language),
    ],
    plainText: lead,
  }
}

/* --- results ---------------------------------------------------------------- */

export function buildCreativeSetItem(
  creativeId: string,
  creative: StoredCreative,
  position: number,
): CreativeSetItem {
  const image = creative.content.image
  return {
    creativeId,
    position,
    name: creative.name,
    format: creative.format,
    headline: creative.content.headline,
    subheadline: creative.content.subheadline,
    callToAction: creative.content.callToAction,
    offerText: creative.content.offerText,
    image:
      image && image.storagePath
        ? { storagePath: image.storagePath, source: image.source, altText: image.altText }
        : null,
    imageFailed: creative.imageError !== null,
  }
}

export interface CreatedPoster {
  position: number
  creativeId: string
  creative: StoredCreative
  copyFellBack: boolean
  /** The picture this poster asked for, so the next one can avoid it (§13). */
  imageBrief?: string | null
}

export interface CreativeSetOutcome {
  campaignId: string
  campaignName: string
  /** The positions the owner asked for this time. */
  requested: number[]
  /** Set size, for "2 of the 3". */
  size: number
  /** The set's format and brief, kept on the retry proposal so a missing
   * poster is remade to the same plan. */
  format: CreativeRequestSpec['format']
  brief: string | null
  created: CreatedPoster[]
  /** Positions that were attempted and failed, or not attempted for lack of time. */
  failed: number[]
  /**
   * The guardrail's own sentence when a daily limit stopped the set —
   * repeated to the owner as-is, and no retry is offered against it.
   */
  blockedMessage: string | null
  /** A campaign created in the same action, presented above the posters. */
  campaignCreated: { campaignId: string; campaign: StoredCampaign } | null
  /**
   * Phase 7J §9 — the owner has set no Brand Identity and none was
   * discovered, so the posters used a neutral style. Said once, after the
   * result, as a fact and an invitation — never as a reason to stop.
   */
  brandMissing?: boolean
}

/**
 * The result turn. One poster keeps the presentation the button path has
 * always used; a set gets the compact set card. A partial set says exactly
 * how many exist and offers to try the missing ones — the retry proposal
 * targets only the positions that failed, so nothing is created twice.
 */
export function presentCreativeSetOutcome(
  outcome: CreativeSetOutcome,
  language: ReplyLanguage,
): Presentation {
  const ms = language === 'ms'
  const blocks: MessageBlock[] = []
  const lines: string[] = []
  let nextId = 0
  const id = () => `b${nextId++}`

  const campaignLead = outcome.campaignCreated
    ? ms
      ? `Saya dah buat kempen “${outcome.campaignCreated.campaign.name}” untuk ini.`
      : `I created a campaign for this: “${outcome.campaignCreated.campaign.name}”.`
    : null

  // A single poster with nothing else going on: the existing presentation.
  if (
    outcome.requested.length === 1 &&
    outcome.created.length === 1 &&
    outcome.size === 1 &&
    !outcome.campaignCreated
  ) {
    const only = outcome.created[0] as CreatedPoster
    return buildCreativePresentation(only.creativeId, only.creative, {
      fallbackCopy: only.copyFellBack,
    })
  }

  const createdCount = outcome.created.length
  const requestedCount = outcome.requested.length
  const imageFailures = outcome.created.filter((p) => p.creative.imageError !== null).length
  const anyFallback = outcome.created.some((p) => p.copyFellBack)

  let lead: string
  if (createdCount === requestedCount) {
    lead = ms
      ? `Siap — saya dah buat ${posters(createdCount, 'ms')} untuk “${outcome.campaignName}”.`
      : `Done — I created ${posters(createdCount, 'en')} for “${outcome.campaignName}”.`
  } else if (createdCount > 0) {
    const missing = requestedCount - createdCount
    lead = ms
      ? `Saya dah buat ${createdCount} daripada ${requestedCount} poster. ${missing === 1 ? 'Satu' : String(missing)} tidak dapat disiapkan.`
      : `I created ${createdCount} of the ${requestedCount} posters. ${missing === 1 ? 'One' : String(missing)} couldn’t be completed.`
  } else {
    lead = ms
      ? 'Saya tidak dapat buat poster itu buat masa ini.'
      : 'I couldn’t create the posters just now.'
  }
  if (outcome.blockedMessage) lead = `${lead} ${outcome.blockedMessage}`
  if (imageFailures > 0) {
    lead = `${lead} ${
      ms
        ? `Imej untuk ${imageFailures} daripadanya tidak dapat dibuat — anda boleh cuba lagi dari kad poster.`
        : `The image for ${imageFailures} of them couldn’t be created — you can retry it from the poster.`
    }`
  }
  if (anyFallback) lead = `${lead} ${FALLBACK_COPY_NOTE}`
  // Never a blocker, never a form: the posters exist, and the owner is told
  // once — in one sentence — where the look came from.
  if (outcome.brandMissing && createdCount > 0) {
    lead = `${lead} ${brandFallbackNote(language)}`
  }

  const text = campaignLead ? `${campaignLead} ${lead}` : lead
  blocks.push({ id: id(), type: 'text', text })
  lines.push(text)

  if (outcome.campaignCreated) {
    blocks.push(
      buildCampaignCardBlock(
        id(),
        outcome.campaignCreated.campaignId,
        outcome.campaignCreated.campaign,
      ),
    )
    lines.push(`Campaign: ${outcome.campaignCreated.campaign.name}`)
  }

  if (createdCount > 0) {
    const set: CreativeSetBlock = {
      id: id(),
      type: 'creative_set',
      campaignId: outcome.campaignId,
      campaignName: outcome.campaignName,
      requested: requestedCount,
      items: outcome.created.map((p) => buildCreativeSetItem(p.creativeId, p.creative, p.position)),
    }
    // Phase 7J §12 — exactly one next step, and only when nothing else is
    // already asking for a decision. A retry proposal below (or a daily
    // limit) is the more useful thing to answer, so the suggestion stands
    // down rather than competing with it.
    if (outcome.failed.length === 0 && !outcome.blockedMessage) {
      set.followUp = followUpFor(language)
    }
    blocks.push(set)
    lines.push(...outcome.created.map((p) => `Creative: ${p.creative.name}`))
  }

  // The missing positions, offered again — but never against a daily limit
  // the owner has already hit, and never for positions that exist.
  if (outcome.failed.length > 0 && !outcome.blockedMessage) {
    const retry: ProposedAction = {
      kind: 'creative.generate',
      campaignId: outcome.campaignId,
      campaignName: outcome.campaignName,
      spec: {
        format: outcome.format,
        brief: outcome.brief,
        positions: outcome.failed,
        size: outcome.size,
      },
    }
    blocks.push(buildProposalBlock(id(), retry, language, retryLabelFor(outcome.failed, language)))
  }

  return { blocks, plainText: lines.join('\n\n') }
}

/**
 * The one follow-up EVA offers after a finished set. Deliberately a single,
 * always-true option — another angle on the same campaign — rather than a
 * menu of five guesses about what the owner might want next. Pressing it
 * sends this text as an ordinary message, which the existing request path
 * reads exactly as if it had been typed.
 */
export function followUpFor(language: ReplyLanguage): { label: string; text: string } {
  return language === 'ms'
    ? { label: 'Sudut lain', text: 'Buat satu lagi poster dengan sudut yang berbeza.' }
    : { label: 'Another angle', text: 'Make another poster with a different angle.' }
}

/** Said once when the posters had no Brand Identity to follow. */
export function brandFallbackNote(language: ReplyLanguage): string {
  return language === 'ms'
    ? 'Saya belum ada Identiti Jenama anda, jadi saya guna gaya neutral yang kemas — anda boleh tetapkannya bila-bila masa di Business → Brand.'
    : 'I don’t have your Brand Identity yet, so I used a clean, neutral style — you can set it up any time under Business → Brand.'
}

/** A plain sentence, no action. */
export function presentText(text: string): Presentation {
  return { blocks: [{ id: 'b0', type: 'text', text }], plainText: text }
}

/** "That campaign is no longer available." */
export function campaignGoneText(language: ReplyLanguage): string {
  return language === 'ms'
    ? 'Kempen itu sudah tiada. Beritahu saya kempen mana yang anda mahu, atau saya boleh buatkan yang baru.'
    : 'That campaign isn’t available any more. Tell me which campaign you mean, or I can create a new one.'
}

/** The recommendation behind a proposal is gone (or was never theirs). */
export function campaignBuildGoneText(language: ReplyLanguage): string {
  return language === 'ms'
    ? 'Cadangan itu sudah tiada. Beritahu saya semula apa yang anda nak promosikan dan saya sediakan yang baru.'
    : 'That plan isn’t available any more. Tell me again what you’d like to promote and I’ll put a fresh one together.'
}

/** The Business Brain is missing — the action needs it. */
export function missingBrainText(language: ReplyLanguage): string {
  return language === 'ms'
    ? 'Saya perlu kenal perniagaan anda dulu. Lengkapkan profil perniagaan anda dan saya akan buatkan kempen dan poster untuknya.'
    : 'I need to know your business first. Complete your business profile and I’ll create the campaign and posters for it.'
}

/** A campaign could not be created just now. */
export function campaignFailedText(language: ReplyLanguage, reason: string | null): string {
  const base =
    language === 'ms'
      ? 'Saya tidak dapat buat kempen itu buat masa ini. Cuba lagi sebentar.'
      : 'I couldn’t create the campaign just now. Try again in a moment.'
  return reason ? `${base} ${reason}` : base
}
