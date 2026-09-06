import type {
  ActionProposalBlock,
  CreativeRequestSpec,
  ProposedAction,
  StoredMessage,
} from '../../lib/types'
import { detectCreativeEdit } from '../../marketing/intent'

/**
 * Phase 7F — what, if anything, should EVA *do* about this message?
 *
 * Deterministic and server-side, like the intent detectors it sits beside:
 * no model decides whether money gets spent. Two things can turn a message
 * into an action, and only two:
 *
 *   1. A pending proposal. When EVA's previous turn carried an
 *      `action_proposal` block — "Want me to create the 3 posters?" — a
 *      short affirmation ("okay go design", "yes, make them", "jom") executes
 *      exactly that proposal: its campaign, its count, its format, its
 *      brief. The words "go" or "design" on their own never trigger
 *      anything; the structured state does. The proposal is pending only on
 *      the assistant turn directly before this message, so an old offer
 *      three turns back cannot be re-armed by a stray "ok".
 *
 *   2. An explicit request. "Create 3 posters for the weekend promo" reads
 *      as a request to make something — a creation verb plus a creative
 *      noun, not a question, not an edit — and is executed once the caller
 *      resolves which campaign it is for.
 *
 * Everything else — questions, opinions, strategy talk, edits — is left to
 * the routes that already handle it. Understands English plus the Malay and
 * Manglish MARKA's owners actually type; a phrasing outside these patterns
 * falls through to conversation, where EVA can still offer (and the offer
 * becomes a proposal, closing the loop).
 */

/** How many posters one request may create. Sets beyond this are offered in parts. */
export const MAX_CREATIVES_PER_REQUEST = 3

/** The longest owner text carried into the copy call as set context. */
const BRIEF_MAX_CHARS = 600

export type CreativeGenerateAction = Extract<ProposedAction, { kind: 'creative.generate' }>
export type CampaignChooseAction = Extract<ProposedAction, { kind: 'campaign.choose' }>

export type ChatActionDecision =
  /** Not an action. The existing routes decide what happens. */
  | { type: 'none' }
  /** The owner asked for posters outright; the caller resolves the campaign. */
  | { type: 'creative_request'; spec: CreativeRequestSpec }
  /** The owner affirmed the pending proposal — act on it as proposed. */
  | { type: 'confirm'; action: ProposedAction }
  /** The owner picked one of the offered campaigns. */
  | { type: 'choose'; action: CreativeGenerateAction }
  /** The owner said yes to a choice without choosing — ask again, briefly. */
  | { type: 'reask_choice'; proposal: CampaignChooseAction }

export interface DecisionInput {
  /** The owner's latest message. */
  text: string
  /**
   * EVA's turn directly before it, when the previous message in the thread
   * was hers; null when it was not (or there is none). Only this turn can
   * carry a pending proposal.
   */
  previousAssistant: Pick<StoredMessage, 'role' | 'blocks'> | null
}

/** The proposal pending on the previous assistant turn, if any. */
export function pendingProposal(
  previousAssistant: Pick<StoredMessage, 'role' | 'blocks'> | null,
): ActionProposalBlock | null {
  if (!previousAssistant || previousAssistant.role !== 'assistant') return null
  const block = previousAssistant.blocks.find(
    (candidate): candidate is ActionProposalBlock => candidate.type === 'action_proposal',
  )
  return block ?? null
}

export function decideChatAction(input: DecisionInput): ChatActionDecision {
  const text = input.text.trim()
  if (!text) return { type: 'none' }

  const proposal = pendingProposal(input.previousAssistant)
  if (proposal) {
    const decision = decideOnProposal(text, proposal.action)
    if (decision) return decision
  }

  const spec = parseCreativeRequest(text)
  if (spec) return { type: 'creative_request', spec }

  return { type: 'none' }
}

/* --- proposals ------------------------------------------------------------- */

function decideOnProposal(text: string, action: ProposedAction): ChatActionDecision | null {
  if (action.kind === 'campaign.choose') {
    const index = readChoice(text, action.choices)
    const choice = index !== null ? action.choices[index] : undefined
    if (choice) {
      return {
        type: 'choose',
        action: {
          kind: 'creative.generate',
          campaignId: choice.campaignId,
          campaignName: choice.name,
          spec: action.then,
        },
      }
    }
    if (readAffirmation(text) === 'yes') return { type: 'reask_choice', proposal: action }
    return null
  }

  if (readAffirmation(text) !== 'yes') return null

  // "ok make 2" or "yes, portrait" adjusts the proposal without re-asking;
  // a bare yes keeps it exactly as offered.
  const override = readOverrides(text)
  if (action.kind === 'creative.generate') {
    return { type: 'confirm', action: { ...action, spec: applyOverrides(action.spec, override) } }
  }
  if (action.kind === 'campaign.create') {
    return {
      type: 'confirm',
      action: { ...action, then: action.then ? applyOverrides(action.then, override) : null },
    }
  }
  return { type: 'confirm', action }
}

interface Overrides {
  count: number | null
  format: CreativeRequestSpec['format'] | null
}

function readOverrides(text: string): Overrides {
  return { count: readCountWord(normalise(text)), format: readFormat(text) }
}

function applyOverrides(spec: CreativeRequestSpec, override: Overrides): CreativeRequestSpec {
  let next = spec
  if (override.count !== null && override.count !== spec.positions.length) {
    const count = Math.min(override.count, MAX_CREATIVES_PER_REQUEST)
    next = { ...next, positions: positionsFor(count), size: count }
  }
  if (override.format !== null && override.format !== spec.format) {
    next = { ...next, format: override.format }
  }
  return next
}

/* --- affirmation ------------------------------------------------------------ */

/**
 * Words that turn a short reply into a no, whatever else it says. "Yes but
 * not the third one" is a conversation, not a go-ahead.
 */
const NEGATION =
  /\b(?:no|nope|nah|not|don'?t|dont|never|cancel|stop|wait|hold|later|skip|pause|jangan|tak|tidak|bukan|belum|batal|nanti|tunggu|jap|kejap)\b/

/** Single-word or short-phrase go-aheads, in the languages owners type. */
const AFFIRMATIONS =
  /\b(?:go ahead|go for it|do it|let'?s do it|lets do it|let'?s go|lets go|sounds good|looks good|all good|why not|of course|please do|yes please|sure thing|carry on|go on|okay lah|ok lah|boleh lah|jom lah|buat je|buat jer|buat saja|buat sahaja|teruskan|ya boleh|proceed|confirm|confirmed|approved|agreed|absolutely|definitely|yup|yep|yeah|yes|ya|yah|ye|yer|ok|okay|okey|oke|okeh|okie|k|kk|alright|aight|fine|sure|go|boleh|jom|setuju|sila|silakan|onz|on|great|perfect)\b/

/**
 * "Make them", "create the posters", "design all three", "buatkan" — an
 * imperative that names no *new* thing is a go-ahead for the thing on the
 * table, not a fresh request.
 */
const IMPERATIVE_GO =
  /\b(?:make|create|design|do|build|generate|start|begin|produce|prepare|buat|buatkan|bikin|hasilkan|jana|reka|sediakan|teruskan|mula|mulakan)\b(?:\s+(?:it|them|those|these|that|this|all|all three|all 3|all of them|the|those|semua|kesemua|ketiga-tiga|dia|nya|the \d+|\d+))*(?:\s+(?:posters?|creatives?|materials?|designs?|visuals?|graphics?|poster|bahan|bahan-bahan|ni|tu|itu|ini|posternya|designnya))*/

/**
 * Words a go-ahead may carry without turning into something else: manners,
 * particles, the things being referred to, the numbers already offered.
 */
const FILLER =
  /\b(?:please|pls|plz|thanks|thank|thx|you|now|then|it|them|that|those|the|these|this|all|but|just|only|three|two|one|1|2|3|posters?|poster|creatives?|materials?|designs?|design|designing|create|make|go|ahead|lah|la|je|jer|saja|sahaja|dah|and|start|begin|eva|sounds|semua|kesemua|tolong|terus|ni|tu|itu|ini|kan|dulu|sekarang|of|course|right|away|with|plan|idea|for|me|us|my|our|a|an|so|let'?s|lets|us|we|i|can|could|should|would|will|do|just|nice|cool|awesome|love|good|great|perfect|okay|ok|yes|ya|sure|on|ye|yer|yah|square|portrait|ones|them all|both|first|second|third|pertama|kedua|ketiga|dengan|untuk|saya|kami|kita|boleh|jom|sila|yang|tadi|itu|pun|juga|je|pls)\b/g

/** How long a go-ahead can be. Longer messages are saying something else. */
const AFFIRMATION_MAX_WORDS = 12

export type Affirmation = 'yes' | 'no' | 'other'

/**
 * Does this message, on its own, say "go ahead"? Deliberately generous with
 * *short* messages — its only power is to execute what EVA already proposed
 * — and deliberately blind to anything longer or with content of its own,
 * which the conversation handles.
 */
export function readAffirmation(text: string): Affirmation {
  const clean = normalise(text)
  if (!clean) return 'other'
  if (NEGATION.test(clean)) return 'no'
  if (clean.split(' ').length > AFFIRMATION_MAX_WORDS) return 'other'

  const affirmed = AFFIRMATIONS.test(clean) || IMPERATIVE_GO.test(clean)
  if (!affirmed) return 'other'

  const leftover = clean
    .replace(new RegExp(IMPERATIVE_GO.source, 'g'), ' ')
    .replace(new RegExp(AFFIRMATIONS.source, 'g'), ' ')
    .replace(FILLER, ' ')
    .replace(/\d+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return leftover === '' ? 'yes' : 'other'
}

/* --- choosing a campaign ------------------------------------------------- */

const ORDINAL_WORDS: Record<string, number> = {
  first: 1,
  '1st': 1,
  second: 2,
  '2nd': 2,
  third: 3,
  '3rd': 3,
  fourth: 4,
  '4th': 4,
  fifth: 5,
  '5th': 5,
  pertama: 1,
  kedua: 2,
  ketiga: 3,
  keempat: 4,
  kelima: 5,
}

const CARDINAL_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  satu: 1,
  dua: 2,
  tiga: 3,
  empat: 4,
  lima: 5,
}

/**
 * Which of the offered campaigns the owner picked: by name — the client's
 * choice button sends "Use the campaign: <name>", and a typed name works the
 * same way — by ordinal ("the second one", "yang kedua") or by number ("2").
 * Null when nothing, or more than one thing, matches.
 */
export function readChoice(text: string, choices: { name: string }[]): number | null {
  const clean = normalise(text)
  if (!clean) return null

  const byName = choices
    .map((choice, index) => ({ index, name: normalise(choice.name) }))
    .filter(({ name }) => name.length > 0 && clean.includes(name))
  if (byName.length > 0) {
    // "Weekend promo" vs "Weekend promo extended": the longest name wins.
    const longest = byName.reduce((a, b) => (b.name.length > a.name.length ? b : a))
    return longest.index
  }

  const words = clean.split(' ')
  // "the second one": the ordinal is the choice, the "one" is a pronoun —
  // so ordinals are read first, and cardinals only when no ordinal exists.
  const ordinals = distinct(words.map((word) => ORDINAL_WORDS[word] ?? null))
  const cardinals = distinct(
    words.map((word) => CARDINAL_WORDS[word] ?? (/^\d{1,2}$/.test(word) ? Number(word) : null)),
  )
  const picked = ordinals.length > 0 ? ordinals : cardinals
  const only = picked.length === 1 ? picked[0] : undefined
  if (only !== undefined && only >= 1 && only <= choices.length) return only - 1
  return null
}

function distinct(values: (number | null)[]): number[] {
  return [...new Set(values.filter((value): value is number => value !== null))]
}

/* --- explicit requests --------------------------------------------------- */

/**
 * Questions and opinions are never requests, however many creative nouns
 * they contain: "What should I post this weekend?", "Do you think green
 * works for my poster?".
 */
const QUESTION_OPENERS =
  /^(?:how|what|why|which|when|where|who|whose|whom|should (?:i|we)|do you think|what do you think|is it|is this|is that|are|does|did|was|were|have you|apa|kenapa|mengapa|bagaimana|macam mana|macamana|bila|mana|siapa|patut(?:kah)?|adakah|boleh tak|rasa)\b/

/** Creation verbs, English and Malay. */
const CREATION_VERBS =
  'create|make|design|generate|produce|build|draft|prepare|whip up|put together|mock up|mockup|do|buat|buatkan|bikin|hasilkan|reka|sediakan|cipta|jana|design(?:kan)?|tolong buat'

/** What gets created. Kept to things the creative pipeline actually makes. */
const CREATIVE_NOUNS =
  'posters?|creatives?|marketing materials?|materials?|social posts?|posts?|visuals?|artworks?|graphics?|designs?|banners?|images?|flyers?|ads?|adverts?|advertisements?|poster|iklan|grafik|bahan pemasaran|bahan|visual|gambar|reka bentuk|konten|content'

const CREATION_REQUEST = new RegExp(
  `\\b(?:${CREATION_VERBS})\\b[^.?!]{0,60}?\\b(?:${CREATIVE_NOUNS})\\b`,
  'i',
)

/** "don't make", "no need to create", "not creating" — a request withdrawn. */
const NEGATED_REQUEST = new RegExp(
  `\\b(?:don'?t|dont|do not|no need to|not|never|jangan|tak payah|tak perlu|tidak perlu)\\b[^.?!]{0,20}\\b(?:${CREATION_VERBS})\\b`,
  'i',
)

/** Markers that make an edit-shaped sentence a request for a *new* thing. */
const NEW_MARKERS =
  /\b(?:new|another|fresh|extra|additional|second|baru|lagi|tambah|satu lagi)\b|\bmore\s+(?:\d+\s+)?(?:posters?|creatives?|materials?|designs?|visuals?|graphics?|poster|bahan|iklan)\b|\b\d+\s+more\b/i

const NUMBER_WORDS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  single: 1,
  another: 1,
  two: 2,
  couple: 2,
  pair: 2,
  three: 3,
  few: 3,
  several: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  satu: 1,
  sebuah: 1,
  sekeping: 1,
  dua: 2,
  tiga: 3,
  beberapa: 3,
  empat: 4,
  lima: 5,
  enam: 6,
  tujuh: 7,
  lapan: 8,
  sembilan: 9,
  sepuluh: 10,
}

/**
 * Reads an explicit request for posters. Null when the message is not one —
 * a question, an edit of something that exists, a withdrawn request, or
 * simply a sentence about something else.
 */
export function parseCreativeRequest(text: string): CreativeRequestSpec | null {
  const clean = text.trim()
  if (!clean) return null
  const lower = clean.toLowerCase()

  if (QUESTION_OPENERS.test(lower)) return null
  if (!CREATION_REQUEST.test(clean)) return null
  if (NEGATED_REQUEST.test(clean)) return null
  // "Make the poster more premium" edits the poster that exists; only a
  // new/another/more marker turns an edit-shaped sentence into a request.
  if (detectCreativeEdit(clean) && !NEW_MARKERS.test(clean)) return null

  const requested = readCount(clean)
  const count = Math.min(Math.max(requested, 1), MAX_CREATIVES_PER_REQUEST)
  return {
    format: readFormat(clean) ?? 'square_post',
    brief: clean.slice(0, BRIEF_MAX_CHARS),
    positions: positionsFor(count),
    size: count,
    // The owner asked for more than one request can make: the caller sees
    // `size` capped and says so. `requestedCount` is not part of the wire
    // shape, so the cap is visible only through positions.length.
  }
}

/**
 * How many the owner asked for — the number right before the noun ("3
 * posters", "three square posters", "tiga poster"), else a number word
 * anywhere, else one. "1080x1080" is a size, never a count.
 */
export function readCount(text: string): number {
  return readExplicitCount(text) ?? 1
}

/** The count the text states, or null when it states none. */
export function readExplicitCount(text: string): number | null {
  const clean = normalise(text)
  const nounFirst = new RegExp(
    `\\b(\\d{1,2}|${Object.keys(NUMBER_WORDS).join('|')})\\b(?:\\s+\\w+){0,2}?\\s+(?:${CREATIVE_NOUNS})\\b`,
  )
  const before = nounFirst.exec(clean)?.[1]
  if (before) {
    const value = NUMBER_WORDS[before] ?? Number(before)
    if (Number.isFinite(value) && value > 0) return value
  }
  // "poster tiga keping" — Malay counts can follow the noun.
  const after = new RegExp(
    `\\b(?:${CREATIVE_NOUNS})\\b\\s+(\\d{1,2}|${Object.keys(NUMBER_WORDS).join('|')})\\b`,
  ).exec(clean)?.[1]
  if (after) {
    const value = NUMBER_WORDS[after] ?? Number(after)
    if (Number.isFinite(value) && value > 0) return value
  }
  return readCountWord(clean)
}

/** A standalone count in a short message ("ok make 2", "all three"). */
function readCountWord(clean: string): number | null {
  const match = /\b(\d{1,2})\b/.exec(clean)
  if (match) return Number(match[1])
  for (const word of clean.split(' ')) {
    const value = NUMBER_WORDS[word]
    if (value !== undefined && word !== 'a' && word !== 'an') return value
  }
  return null
}

export function readFormat(text: string): CreativeRequestSpec['format'] | null {
  const lower = text.toLowerCase()
  if (/\b(?:portrait|story|stories|reel|9:16|1080\s*x\s*1920|4:5|1080\s*x\s*1350|menegak|tegak)\b/.test(lower)) {
    return 'portrait_post'
  }
  if (/\b(?:square|1:1|1080\s*x\s*1080|segi ?empat|persegi)\b/.test(lower)) {
    return 'square_post'
  }
  return null
}

export function positionsFor(count: number): number[] {
  return Array.from({ length: count }, (_, index) => index + 1)
}

/* --- EVA's own offers ------------------------------------------------------ */

/** "I can", "shall I", "want me to", "saya boleh" — an offer's opening. */
const OFFER_OPENERS =
  "i can|i could|i'll|i will|i'd be happy to|i'm happy to|happy to|shall i|should i|want me to|would you like me to|do you want me to|let me|ready to|i can go ahead and|say the word and i'll|just say (?:go|the word)|saya boleh|boleh saya|nak saya|mahu saya|biar saya|saya akan"

const OFFER_VERBS =
  'create|make|design|generate|prepare|produce|put together|draft|build|mock up|whip up|get started on|start on|go ahead and (?:create|make|design)|buat|buatkan|sediakan|reka|hasilkan|cipta|jana|mulakan'

const ASSISTANT_OFFER = new RegExp(
  `\\b(?:${OFFER_OPENERS})\\b[^.?!]{0,40}?\\b(?:${OFFER_VERBS})\\b[^.?!]{0,80}?\\b(?:${CREATIVE_NOUNS})\\b`,
  'i',
)

/**
 * Did EVA's *own* reply offer to create materials? When it did, the offer
 * becomes a real proposal on her turn — so the "yes" that follows executes
 * something, instead of being answered with more prose. Reads the count
 * from her sentence ("the 3 posters"); the caller resolves the campaign.
 */
export function detectAssistantOffer(replyText: string): AssistantOffer | null {
  const match = ASSISTANT_OFFER.exec(replyText)
  if (!match) return null
  // "I can't create posters", "I cannot make…", "tidak boleh buat" — a
  // limit being explained, not an offer.
  if (OFFER_NEGATION.test(match[0])) return null
  const stated = readExplicitCount(match[0])
  const count = Math.min(Math.max(stated ?? 1, 1), MAX_CREATIVES_PER_REQUEST)
  return { count, explicit: stated !== null, format: readFormat(replyText) ?? 'square_post' }
}

export interface AssistantOffer {
  count: number
  /** False when the sentence named no number ("the posters") and 1 is a default. */
  explicit: boolean
  format: CreativeRequestSpec['format']
}

const OFFER_NEGATION = /\b(?:can't|cannot|can not|couldn't|could not|won't|will not|unable|not able|tak boleh|tidak boleh|tidak dapat|tak dapat)\b/i

/**
 * The plan the owner is agreeing to, in EVA's own words: her numbered or
 * bulleted list when she wrote one ("1. English — Introduction…"), else the
 * opening of her reply. Carried into the copy call as the set's brief so
 * poster 2 really is the second concept she proposed.
 */
export function extractOfferBrief(replyText: string, maxChars = BRIEF_MAX_CHARS): string | null {
  const lines = replyText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^(?:\d{1,2}[.):]|[-•*])\s+\S/.test(line))
  const source = lines.length >= 2 ? lines.join('\n') : replyText.trim()
  const brief = source.replace(/\*\*/g, '').slice(0, maxChars).trim()
  return brief.length > 0 ? brief : null
}

/* --- helpers --------------------------------------------------------------- */

/** Lowercase, punctuation and emoji stripped, whitespace collapsed. */
export function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’‘`´]/g, "'")
    .replace(/[^\p{L}\p{N}'\s:]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
