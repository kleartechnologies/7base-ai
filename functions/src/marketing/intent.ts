/**
 * Does this message need marketing intelligence, or just a reply?
 *
 * Deliberately not a model call and not a rules engine. A greeting must not
 * cost a reasoning-tier invocation, and an owner saying "I want more
 * customers" must not get small talk — that is the whole requirement, and a
 * handful of patterns meets it. When more intents exist (create creative,
 * analyse results), this becomes the place a real classifier replaces one
 * function, without the callers changing.
 *
 * Understands English plus the Malay/Manglish phrasings MARKA's owners
 * actually type ("nak lebih customer weekday", "jualan perlahan"): the same
 * heuristic, extended with Malay want-verbs, demand nouns and slow-words —
 * not a multilingual classifier. A phrasing outside these patterns falls
 * through to normal conversation, where MARKA can still discuss it.
 */

export type ChatIntent = 'marketing_goal' | 'conversation'

export interface IntentSignals {
  /**
   * True when MARKA's latest turn carried a recommendation. Short follow-ups
   * like "what if I target families instead?" only read as marketing in that
   * context; on their own they are conversation.
   */
  afterRecommendation?: boolean
}

/** Who or what the owner wants more of. English and Malay. */
const DEMAND_NOUNS =
  'customers?|sales?|orders?|traffic|visitors?|walk[- ]?ins?|bookings?|guests?|diners?|buyers?|clients?|regulars|revenue|foot ?traffic|families|tourists|students|office workers|pelanggan|jualan|ramai orang'

/** "business is slow", in both languages. */
const SLOW_WORDS = 'slow|down|quiet|dropping|declining|low|falling|perlahan|sunyi|menurun'

/** Times of day and week that can be slow. */
const DAY_PARTS =
  'weekdays?|weekends?|lunch(?:time)?|dinners?|mornings?|nights?|afternoons?'

/** The things a small business announces: what "new" attaches to. */
const NEW_THINGS =
  'menu|menus|product|products|item|items|dish|dishes|drink|drinks|service|services|offer|offers|promo|promotion|deal|deals|package|packages|opening|branch|outlet|store|shop|produk|barang|hidangan|minuman|perkhidmatan|tawaran|cawangan|kedai'

/**
 * Festive and calendar moments a Malaysian owner markets around. Naming one
 * ("I need something for Raya") is a marketing goal even with no verb.
 */
const OCCASIONS =
  'raya|hari raya|aidilfitri|aidiladha|ramadan|ramadhan|puasa|cny|chinese new year|tahun baru cina|deepavali|diwali|christmas|xmas|krismas|merdeka|malaysia day|new year|tahun baru|valentine|mother\'s day|father\'s day|school holidays|cuti sekolah|back to school'

const GOAL_PATTERNS: RegExp[] = [
  // "I want more customers", "attract families", "bring in weekday diners"
  new RegExp(
    `\\b(?:more|attract|increase|boost|grow|bring in|get|win|gain|drive|double)\\b[^.?!]{0,60}\\b(?:${DEMAND_NOUNS})\\b`,
    'i',
  ),
  // "nak lebih customer weekday", "mahu lebih pelanggan", "nak ramai customer"
  new RegExp(`\\b(?:nak|mahu|nakkan|hendak)\\b[^.?!]{0,60}\\b(?:${DEMAND_NOUNS})\\b`, 'i'),
  // "sales are slow", "bookings have been dropping", "jualan weekday perlahan"
  new RegExp(`\\b(?:${DEMAND_NOUNS})\\b[^.?!]{0,40}\\b(?:${SLOW_WORDS})\\b`, 'i'),
  // "weekdays are quiet", "slow lunch hours", "weekday sunyi"
  new RegExp(`\\b(?:slow|quiet|empty|dead|sunyi|perlahan)\\b[^.?!]{0,30}\\b(?:${DAY_PARTS})\\b`, 'i'),
  new RegExp(`\\b(?:${DAY_PARTS})\\b[^.?!]{0,30}\\b(?:slow|quiet|empty|dead|sunyi|perlahan)\\b`, 'i'),
  // "I want to promote our new lamb shank", "any promotion ideas?"
  /\b(?:promote|promotion|promoting)\b/i,
  // "marketing ideas", "help with a marketing plan"
  /\bmarketing\b[^.?!]{0,30}\b(?:idea|ideas|plan|help|strategy|advice)\b/i,
  // "what should I promote this weekend?", "what should we focus on?"
  /\bwhat should (?:i|we)\b[^.?!]{0,40}\b(?:promote|market|push|feature|advertise|focus on)\b/i,
  // "run a campaign", "plan a promo"
  /\b(?:launch|run|start|create|plan)\b[^.?!]{0,30}\b(?:campaign|promo)\b/i,
  // "what's my best marketing opportunity right now?", "any growth opportunities?"
  /\b(?:marketing|best|biggest|growth|business|sales|good)\b[^.?!]{0,20}\bopportunit(?:y|ies)\b/i,
  // "is there an opportunity to grow/sell more?"
  /\bopportunit(?:y|ies)\b[^.?!]{0,30}\b(?:grow|growth|market|promote|sell)\b/i,
  // "what should I do to grow?", "how do I grow my business?"
  /\bwhat should (?:i|we) do\b[^.?!]{0,40}\bgrow\b/i,
  /\bgrow (?:my|our|the) business\b/i,
  // Phase 7J §2 — the sentences owners actually open with, none of which
  // name a product concept. "Help me market my restaurant", "tolong
  // pasarkan kedai saya". Still deterministic, still no model call.
  /\b(?:help|tolong|bantu)\b[^.?!]{0,20}\b(?:market|advertise|promote|sell|pasarkan|promosikan|iklankan)\b/i,
  /\b(?:promosi|promosikan|iklankan|pasarkan|memasarkan)\b/i,
  // "I want to announce our new product", "nak umumkan menu baru"
  new RegExp(
    `\\b(?:announce|launch|introduce|umum(?:kan)?|lancar(?:kan)?|perkenalkan)\\b[^.?!]{0,40}\\b(?:${NEW_THINGS})\\b`,
    'i',
  ),
  // "I have a new menu", "we just added a new dish", "ada menu baru"
  new RegExp(
    `\\b(?:i have|we have|got|added|adding|ada|baru dapat)\\b[^.?!]{0,20}\\bnew\\b[^.?!]{0,20}\\b(?:${NEW_THINGS})\\b`,
    'i',
  ),
  // The Malay half: "menu baru", "produk baharu" — the noun leads.
  new RegExp(`\\b(?:${NEW_THINGS})\\s+(?:baharu|baru)\\b`, 'i'),
  // "I need something for Raya", "something for the weekend"
  new RegExp(
    `\\b(?:need|want|nak|mahu|perlu)\\b[^.?!]{0,20}\\bsomething\\b[^.?!]{0,20}\\bfor\\b[^.?!]{0,30}\\b(?:${OCCASIONS}|${DAY_PARTS})\\b`,
    'i',
  ),
  new RegExp(`\\b(?:for|untuk)\\s+(?:${OCCASIONS})\\b`, 'i'),
]

/** Only meaningful right after a recommendation. */
const FOLLOW_UP_PATTERNS: RegExp[] = [
  /\bwhat if\b/i,
  /\binstead\b/i,
  /\brather than\b/i,
  /\btarget\b/i,
  /\bfocus on\b/i,
  /\bwhat about\b/i,
]

export function detectIntent(text: string, signals: IntentSignals = {}): ChatIntent {
  const clean = text.trim()
  if (!clean) return 'conversation'

  if (GOAL_PATTERNS.some((pattern) => pattern.test(clean))) return 'marketing_goal'

  if (signals.afterRecommendation && FOLLOW_UP_PATTERNS.some((pattern) => pattern.test(clean))) {
    return 'marketing_goal'
  }

  return 'conversation'
}

/* --- campaign editing ---------------------------------------------------- */

/** An explicit reference to a campaign, in either language. */
const CAMPAIGN_WORDS = /\b(?:campaign|kempen)\b/i

/**
 * Messages that read as an instruction to change something — "make this more
 * premium", "don't use discounts", "change the campaign to 30 days". Only
 * meaningful when the conversation actually has a campaign; the caller checks
 * that, because it takes a Firestore read this module must not do.
 */
const CAMPAIGN_EDIT_PATTERNS: RegExp[] = [
  // "Make this more premium.", "make it feel less formal"
  /\bmake\b[^.?!]{0,40}\b(?:more|less)\b/i,
  /\b(?:more|less) (?:premium|casual|formal|playful|serious|fun|upmarket|affordable)\b/i,
  // "Change the campaign to 30 days.", "update the offer", "tweak the message"
  /\b(?:change|update|edit|adjust|revise|tweak|rework)\b[^.?!]{0,50}\b(?:campaign|kempen|name|offer|message|audience|duration|channels?|call to action|cta|objective|positioning|it|this|that)\b/i,
  /\brename\b/i,
  // "Target families instead."
  /\btarget\b[^.?!]{0,40}\binstead\b/i,
  // "Don't use discounts.", "no discounts please"
  /\bdon'?t (?:use|include|mention|offer|do)\b/i,
  /\bno (?:discounts?|promos?|vouchers?|emojis?)\b/i,
  // "jangan guna diskaun", "tukar kempen ni"
  /\bjangan (?:guna|pakai|letak|bagi)\b/i,
  /\b(?:tukar|ubah)\b[^.?!]{0,40}\b(?:kempen|campaign)\b/i,
  // "shorten it", "extend the campaign to a month"
  /\b(?:shorten|extend|lengthen)\b/i,
]

/**
 * Does this message read as an instruction to edit a campaign? Deliberately
 * checked before goal detection by the caller: once a campaign exists in the
 * thread, "target families instead" edits it rather than spawning a second
 * recommendation.
 */
export function detectCampaignEdit(text: string): boolean {
  const clean = text.trim()
  if (!clean) return false
  return CAMPAIGN_EDIT_PATTERNS.some((pattern) => pattern.test(clean))
}

/** Whether the message explicitly names a campaign — used to decide between
 * falling through to conversation and asking which campaign is meant. */
export function mentionsCampaign(text: string): boolean {
  return CAMPAIGN_WORDS.test(text)
}

/* --- creative editing ----------------------------------------------------- */

/**
 * The nouns of a creative: what a poster and its captions are made of. Used
 * to route a generic edit instruction to the right artifact once both a
 * campaign and a creative exist in a thread.
 */
const CREATIVE_WORDS =
  /\b(?:headline|sub-?headline|caption|captions|poster|image|photo|picture|visual|hashtags?|tagline|wording|copy|cta|alt ?text|creative|materials?)\b/i

/**
 * Concepts only a campaign has. A message that names one of these (and no
 * creative noun) is steering strategy, not wording.
 */
const CAMPAIGN_CONCEPT_WORDS =
  /\b(?:campaign|kempen|audience|duration|channels?|objective|positioning|days?|weeks?|budget)\b/i

/**
 * The visual side of a creative: what an instruction names when it wants a
 * different *picture*, not different words.
 */
const VISUAL_NOUNS =
  'posters?|images?|photos?|pictures?|visuals?|creatives?|designs?|artworks?|graphics?|backgrounds?|scenes?|gambar|reka bentuk|latar'

/**
 * The written side of a creative: what an instruction names when it wants
 * different *words*, not a different picture. Kept apart from the visual
 * nouns because the two lead to different work — a copy edit costs a fast
 * wording call, a visual edit can cost an image.
 */
const COPY_NOUNS =
  'headlines?|sub-?headlines?|captions?|taglines?|wording|copy|text|cta|call to action|tajuk|ayat|teks|kapsyen|perkataan'

/** "the", "our", "that" — the small words that sit between a verb and its noun. */
const NOUN_LEAD = '(?:the|a|an|our|my|that|this|its)?\\s*'

/**
 * Phrasings that are edit instructions for a creative — "make the caption
 * shorter", "rewrite the headline", "regenerate the poster with a student on
 * a phone" — which the campaign edit patterns (built around strategy words)
 * do not all catch.
 *
 * The image-change phrasings matter as much as the copy ones: an owner who
 * asks for a different picture is editing the creative they are looking at,
 * and without these the message routes nowhere and the conversation loops on
 * acknowledgements. Asking for *another* creative is a different thing, and
 * stays a creation request — the caller lifts this veto when the message
 * carries a new/another/more marker.
 */
const CREATIVE_EDIT_PATTERNS: RegExp[] = [
  // "Make the caption shorter.", "make the headline punchier"
  /\bmake\b[^.?!]{0,40}\b(?:shorter|longer|catchier|punchier|simpler|clearer|bolder|snappier)\b/i,
  /\b(?:rewrite|reword|rephrase)\b/i,
  // "remove the hashtags", "add an emoji to the caption"
  /\b(?:remove|add|drop)\b[^.?!]{0,40}\b(?:hashtags?|emojis?|caption|headline|tagline)\b/i,
  // "Regenerate the poster.", "redo it", "redesign this", "buat semula"
  /\b(?:re-?generate|re-?do|re-?design|re-?make|re-?create|re-?draw)\b/i,
  /\bbuat semula\b|\bulang\b/i,
  // "change the image to a student on a phone", "swap the photo", "tukar gambar"
  new RegExp(
    `\\b(?:change|update|replace|swap|switch|fix|improve)\\b[^.?!]{0,50}\\b(?:${VISUAL_NOUNS})\\b`,
    'i',
  ),
  new RegExp(`\\b(?:tukar|ubah|ganti|betulkan)\\b[^.?!]{0,50}\\b(?:${VISUAL_NOUNS})\\b`, 'i'),
  // The same two verbs aimed at the words instead of the picture. Phase 7K:
  // "Change the headline to something more urgent" — the single most
  // ordinary edit an owner types — matched nothing here, so it fell past
  // the creative editor, past the campaign editor, and came back as
  // conversation. The instruction was read, agreed with, and not carried out.
  new RegExp(
    `\\b(?:change|update|replace|swap|switch|fix|improve|shorten|lengthen|soften|sharpen)\\b[^.?!]{0,50}\\b(?:${COPY_NOUNS})\\b`,
    'i',
  ),
  new RegExp(
    `\\b(?:tukar|ubah|ganti|betulkan|pendekkan|panjangkan)\\b[^.?!]{0,50}\\b(?:${COPY_NOUNS})\\b`,
    'i',
  ),
  // "add a student using the app to the poster", "put our logo on the image".
  // The preposition is required so that "put together 3 posters" stays what it
  // plainly is — a request for three new posters, not an edit of one.
  new RegExp(
    `\\b(?:add|put|include)\\b[^.?!]{0,60}\\b(?:to|on|in|into|onto)\\s+${NOUN_LEAD}(?:${VISUAL_NOUNS})\\b`,
    'i',
  ),
  new RegExp(
    `\\b(?:masukkan|letak|tambah)\\b[^.?!]{0,60}\\b(?:dalam|pada|kat|ke)\\s+${NOUN_LEAD}(?:${VISUAL_NOUNS})\\b`,
    'i',
  ),
]

/**
 * Does this message read as an instruction to edit *something*? The campaign
 * patterns already cover most instructions ("make this more premium", "don't
 * mention discounts", "change the CTA"); this extends them with copy-specific
 * phrasings. Which artifact it lands on is the caller's routing decision.
 */
export function detectCreativeEdit(text: string): boolean {
  const clean = text.trim()
  if (!clean) return false
  return (
    detectCampaignEdit(clean) || CREATIVE_EDIT_PATTERNS.some((pattern) => pattern.test(clean))
  )
}

/** Whether the message names any part of a creative. */
export function mentionsCreative(text: string): boolean {
  return CREATIVE_WORDS.test(text)
}

/** Whether the message names a campaign-only concept. */
export function mentionsCampaignConcept(text: string): boolean {
  return CAMPAIGN_CONCEPT_WORDS.test(text)
}
