import type { CreativeContent } from './validate'

/**
 * Poster copy discipline (Phase 7G, §8/§9).
 *
 * A poster and a caption do different jobs. The poster gets attention, one
 * message and one action — a headline someone reads from a phone at arm's
 * length, a single supporting line, a two-or-three-word button. The caption
 * is where explanation, details, links and hashtags belong. Left to a model
 * alone this line blurs: the headline becomes a sentence, the button becomes
 * a URL set in 40pt, and the poster stops looking designed.
 *
 * So the limits are enforced here, deterministically, after the wording call
 * and after validation. Shortening only ever *removes* words — it can never
 * introduce a claim the grounding check did not already clear — and it only
 * touches the poster fields, so the full sentence, the link and the details
 * still ship in the captions.
 */

/** Poster-display limits, in characters. Tighter than the storage limits. */
export const POSTER_COPY_LIMITS = {
  headline: 48,
  subheadline: 95,
  callToAction: 24,
  offerText: 28,
} as const

/** Words a shortened line must not be left dangling on. */
const TRAILING_CONNECTORS = new Set([
  'a',
  'an',
  'and',
  'at',
  'atau',
  'dan',
  'dari',
  'daripada',
  'de',
  'di',
  'for',
  'from',
  'in',
  'ke',
  'kepada',
  'melalui',
  'on',
  'or',
  'our',
  'pada',
  'the',
  'to',
  'untuk',
  'via',
  'with',
  'your',
  '&',
  '-',
  '–',
  '—',
  '+',
])

// Ordered: an email is matched before the bare domain inside it, so
// "hi@kedai.my" is removed whole rather than leaving "hi@" behind.
const LINK_PATTERNS = [
  /\b(?:https?:\/\/|www\.)\S+/gi,
  /\b[^\s@]+@[^\s@]+\.[a-z]{2,}\b/gi,
  /\b[a-z0-9][a-z0-9-]*\.(?:com|my|net|org|io|app|co|shop|store|me|xyz)(?:\.[a-z]{2})?(?:\/\S*)?\b/gi,
]

/** Marks a removed link, so the word that introduced it can go with it. */
const REMOVED = '\u0000'

/**
 * Drops links and emails — they belong in the caption, never on a button —
 * and takes the preposition that introduced them along: "Muat turun di
 * matheasy.my" is a button that reads "Muat turun", not "Muat turun di".
 */
export function stripLinks(value: string): string {
  const marked = LINK_PATTERNS.reduce((text, pattern) => text.replace(pattern, REMOVED), value)
  const connectors = [...TRAILING_CONNECTORS].filter((word) => /^[a-z&]+$/.test(word)).join('|')
  return marked
    .replace(new RegExp(`(?<![\\p{L}\\p{N}])(?:${connectors})\\s*${REMOVED}`, 'giu'), REMOVED)
    .replace(new RegExp(REMOVED, 'g'), ' ')
}

/** The first sentence only — a poster headline is never a paragraph. */
function firstSentence(value: string): string {
  const [first] = value.split(/\n+/)
  const sentences = (first ?? value).split(/(?<=[.!?])\s+/)
  return sentences[0] ?? value
}

/** The leading clause, when even one sentence runs long. */
function firstClause(value: string): string {
  const [first] = value.split(/\s+[—–-]\s+|[,;:]\s+/)
  return first ?? value
}

/** As many leading words as fit. Never cuts a word in half, never adds "…". */
function capWords(value: string, limit: number): string {
  const words = value.split(/\s+/).filter(Boolean)
  const kept: string[] = []
  for (const word of words) {
    const next = kept.length === 0 ? word : `${kept.join(' ')} ${word}`
    if (next.length > limit) break
    kept.push(word)
  }
  // A single word longer than the limit is left whole: a chopped word reads
  // as a bug, an over-long one merely sets a size smaller.
  if (kept.length === 0) return words[0] ?? ''
  return kept.join(' ')
}

/** Tidies the ends: stray punctuation, and dangling joining words. */
function tidy(value: string): string {
  let text = value.replace(/\s+/g, ' ').trim()
  text = text.replace(/^[\s\-–—,;:.]+/, '').replace(/[\s\-–—,;:]+$/, '')
  for (;;) {
    const words = text.split(' ')
    const last = words[words.length - 1]?.toLowerCase().replace(/[.,;:!?]+$/, '') ?? ''
    if (words.length > 1 && TRAILING_CONNECTORS.has(last)) {
      words.pop()
      text = words.join(' ')
      continue
    }
    break
  }
  return text.replace(/[\s,;:]+$/, '')
}

/** One line, shortened to fit, with links removed when asked. */
function posterLine(
  value: string | null,
  limit: number,
  options: { links: 'keep' | 'strip'; period: 'keep' | 'drop' },
): string | null {
  if (!value) return null
  let text = options.links === 'strip' ? stripLinks(value) : value
  text = tidy(text)
  if (!text) return null
  if (text.length > limit) text = tidy(firstSentence(text))
  if (text.length > limit) text = tidy(firstClause(text))
  if (text.length > limit) text = tidy(capWords(text, limit))
  if (options.period === 'drop') text = text.replace(/\.+$/, '')
  return text || null
}

/** The main line: short, no trailing full stop, at most one sentence. */
export function posterHeadline(value: string | null): string | null {
  return posterLine(value, POSTER_COPY_LIMITS.headline, { links: 'strip', period: 'drop' })
}

/** The one supporting line under it. Longer explanation stays in the caption. */
export function posterSupportingLine(value: string | null): string | null {
  return posterLine(value, POSTER_COPY_LIMITS.subheadline, { links: 'strip', period: 'keep' })
}

/** The button: an action, never a link, never a sentence. */
export function posterCallToAction(value: string | null): string | null {
  const short = posterLine(value, POSTER_COPY_LIMITS.callToAction, {
    links: 'strip',
    period: 'drop',
  })
  if (!short) return null
  // Three words is a button; five is a sentence someone drew a box around.
  const words = short.split(' ')
  return words.length > 3 ? tidy(words.slice(0, 3).join(' ')) || null : short
}

/** The offer, as displayable poster text. Prices survive; conditions don't. */
export function posterOfferText(value: string | null): string | null {
  return posterLine(value, POSTER_COPY_LIMITS.offerText, { links: 'strip', period: 'drop' })
}

/**
 * The poster half of a creative's copy, disciplined. `body` and the captions
 * are untouched — that is where the sentence the headline came from, the
 * link and the details still live.
 */
export function disciplinePosterCopy(
  content: Omit<CreativeContent, 'image' | 'layout'>,
): Omit<CreativeContent, 'image' | 'layout'> {
  return {
    ...content,
    headline: posterHeadline(content.headline),
    subheadline: posterSupportingLine(content.subheadline),
    callToAction: posterCallToAction(content.callToAction),
    offerText: posterOfferText(content.offerText),
  }
}
